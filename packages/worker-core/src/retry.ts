import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";

import { fullJitterBackoffMs } from "@orbital-stellar/pulse-core";

import { classifySubmissionError, type SubmissionFailure } from "./errors.js";

/**
 * A submission that may be retried. The window boundary is the load-bearing
 * field: every attempt (including retries) must complete before
 * `windowDeadlineMs`, otherwise the run is expired and must dead-letter rather
 * than leak into the next period (a payroll run for August must never land in
 * September because a retry chain outlived August).
 */
export type SubmissionHandle = {
  submissionId: string;
  /** Epoch ms by which the submission must succeed or be dead-lettered. */
  windowDeadlineMs: number;
  metadata?: Record<string, unknown>;
};

export type RetryPolicyConfig = {
  /**
   * Maximum number of total attempts, counting the original. `maxAttempts: 3`
   * means one initial try plus two retries.
   */
  maxAttempts: number;
  /** Base backoff delay for attempt 1 -> 2 (ms). */
  initialDelayMs: number;
  /** Upper bound for a single backoff delay (ms). */
  maxDelayMs: number;
  /**
   * Apply full-jitter (random in `[0, exponentialDelay]`) using pulse-core's
   * shared curve. Defaults to `true`. Set `false` for deterministic tests.
   */
  jitter?: boolean;
  /** Clock source, injectable for testing. Defaults to `Date.now`. */
  now?: () => number;
};

/** Outcome of evaluating a failed attempt against the retry policy. */
export type RetryDecision =
  | { action: "retry"; attempt: number; nextRetryAt: number }
  | {
      action: "deadletter";
      reason: "terminal" | "window_expired" | "max_attempts";
      attempt: number;
      failure: SubmissionFailure;
    };

const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

/**
 * Pure retry policy: given the attempt number, the error, the submission's
 * window, and the policy config, decide whether to retry (and when) or to
 * dead-letter (and why). It has no I/O and no clock side effects beyond the
 * injected `now`, so it is trivially unit-testable.
 */
export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitter: boolean;
  private readonly now: () => number;

  constructor(config: RetryPolicyConfig) {
    if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) {
      throw new Error("RetryPolicy.maxAttempts must be a positive integer");
    }
    if (!Number.isFinite(config.initialDelayMs) || config.initialDelayMs < 0) {
      throw new Error("RetryPolicy.initialDelayMs must be a non-negative number");
    }
    if (!Number.isFinite(config.maxDelayMs) || config.maxDelayMs < 0) {
      throw new Error("RetryPolicy.maxDelayMs must be a non-negative number");
    }
    this.maxAttempts = config.maxAttempts;
    this.initialDelayMs = config.initialDelayMs;
    this.maxDelayMs = config.maxDelayMs;
    this.jitter = config.jitter ?? true;
    this.now = config.now ?? Date.now;
  }

  /**
   * Decide what to do after `attempt` failed with `error`.
   *
   * Order of evaluation:
   *  1. Terminal failure (contract rejection) -> dead-letter immediately.
   *  2. Out of attempts -> dead-letter (`max_attempts`).
   *  3. Next retry would fall outside the window -> dead-letter (`window_expired`).
   *  4. Otherwise schedule a retry using the shared pulse-core backoff curve.
   */
  decide(attempt: number, error: unknown, submission: SubmissionHandle): RetryDecision {
    const failure = classifySubmissionError(error);

    if (!failure.retryable) {
      return { action: "deadletter", reason: "terminal", attempt, failure };
    }

    if (attempt >= this.maxAttempts) {
      return { action: "deadletter", reason: "max_attempts", attempt, failure };
    }

    const now = this.now();
    const delayMs = this.delayForAttempt(attempt);
    const nextRetryAt = now + delayMs;

    if (nextRetryAt > submission.windowDeadlineMs) {
      return { action: "deadletter", reason: "window_expired", attempt, failure };
    }

    return { action: "retry", attempt: attempt + 1, nextRetryAt };
  }

  /** Backoff delay (ms) before attempt `attempt + 1`, capped at `maxDelayMs`. */
  delayForAttempt(attempt: number): number {
    const exponential = Math.min(this.initialDelayMs * 2 ** (attempt - 1), this.maxDelayMs);
    if (!this.jitter) return Math.floor(exponential);
    return fullJitterBackoffMs(attempt, this.initialDelayMs, this.maxDelayMs);
  }
}

/**
 * A pending retry, persisted by a {@link WorkerRetryQueue} so the retry chain
 * survives a process restart. `failures` is the full chain of classified
 * failures seen so far, handed to the dead-letter store once retries exhaust.
 */
export type WorkerRetryRecord = {
  id: string;
  submission: SubmissionHandle;
  /** The attempt number this record is scheduled to perform next. */
  attempt: number;
  nextRetryAt: number;
  lastError?: string;
  failures: SubmissionFailure[];
  createdAt: number;
  updatedAt: number;
};

/**
 * Durable queue of pending submission retries. Implementations must persist
 * enough state that a crash/restart resumes the in-flight retry chains rather
 * than dropping them (see {@link FileWorkerRetryQueue}).
 */
export interface WorkerRetryQueue {
  /** Insert or update a pending retry (upsert keyed by `id`). */
  enqueue(record: WorkerRetryRecord): Promise<void>;
  /** Return the earliest-due record whose `nextRetryAt <= now`, or `null`. */
  dequeue(nowMs?: number): Promise<WorkerRetryRecord | null>;
  /** Remove a record because its attempt succeeded. */
  ack(recordId: string): Promise<void>;
  /** Number of queued (not yet acked/dead-lettered) records. */
  size(): Promise<number>;
}

export type MemoryWorkerRetryQueueOptions = {
  now?: () => number;
  visibilityTimeoutMs?: number;
};

/**
 * In-memory reference implementation of {@link WorkerRetryQueue}.
 *
 * Drop-in and dependency-free, with the same ordered/visibility-timeout
 * semantics as {@link FileWorkerRetryQueue}; **not durable** across restarts.
 * It exists as the canonical contract and for tests - use a backing store for
 * real durability.
 */
export class MemoryWorkerRetryQueue implements WorkerRetryQueue {
  private readonly queued = new Map<string, WorkerRetryRecord>();
  private readonly inFlight = new Map<string, { record: WorkerRetryRecord; expiresAt: number }>();
  private readonly now: () => number;
  private readonly visibilityTimeoutMs: number;

  constructor(options: MemoryWorkerRetryQueueOptions = {}) {
    this.now = options.now ?? Date.now;
    this.visibilityTimeoutMs = Math.max(
      1,
      Math.floor(options.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS),
    );
  }

  async enqueue(record: WorkerRetryRecord): Promise<void> {
    this.queued.set(record.id, { ...record, updatedAt: this.now() });
  }

  async dequeue(nowMs: number = this.now()): Promise<WorkerRetryRecord | null> {
    this.reclaimExpiredInFlight(nowMs);

    let best: WorkerRetryRecord | undefined;
    for (const record of this.queued.values()) {
      if (record.nextRetryAt > nowMs) continue;
      if (
        best === undefined ||
        record.nextRetryAt < best.nextRetryAt ||
        (record.nextRetryAt === best.nextRetryAt && record.id < best.id)
      ) {
        best = record;
      }
    }
    if (best === undefined) return null;

    this.queued.delete(best.id);
    this.inFlight.set(best.id, { record: best, expiresAt: nowMs + this.visibilityTimeoutMs });
    return { ...best };
  }

  async ack(recordId: string): Promise<void> {
    this.inFlight.delete(recordId);
    this.queued.delete(recordId);
  }

  async size(): Promise<number> {
    return this.queued.size;
  }

  private reclaimExpiredInFlight(nowMs: number): void {
    for (const [id, entry] of this.inFlight) {
      if (entry.expiresAt <= nowMs) {
        this.inFlight.delete(id);
        this.queued.set(id, { ...entry.record, nextRetryAt: nowMs, updatedAt: nowMs });
      }
    }
  }
}

export type FileWorkerRetryQueueOptions = {
  /** Directory holding the queue state file. Defaults to a temp file. */
  dir?: string;
  filename?: string;
  now?: () => number;
};

/**
 * Durable {@link WorkerRetryQueue} backed by a single JSON file.
 *
 * Because the pending retry records (including their `failures` chain and
 * `nextRetryAt`) are written to disk on every mutation, an operator restart
 * replays the exact same retry chain from where it left off - the retry state
 * survives the process. Records are reloaded lazily on first use.
 *
 * A single file is chosen over a per-record scheme to keep the dependency
 * surface to `fs` only; the queue is expected to hold at most thousands of
 * pending submissions, which serializes comfortably.
 */
export class FileWorkerRetryQueue implements WorkerRetryQueue {
  private readonly file: string;
  private readonly now: () => number;
  private cache: WorkerRetryRecord[] | null = null;

  constructor(options: FileWorkerRetryQueueOptions = {}) {
    const dir = options.dir ?? path.join(tmpdir(), "orbital-worker-retry");
    this.file = path.join(dir, options.filename ?? "retry-queue.json");
    this.now = options.now ?? Date.now;
  }

  async enqueue(record: WorkerRetryRecord): Promise<void> {
    const records = await this.load();
    const updated: WorkerRetryRecord = { ...record, updatedAt: this.now() };
    const idx = records.findIndex((r) => r.id === record.id);
    if (idx >= 0) records[idx] = updated;
    else records.push(updated);
    await this.persist(records);
  }

  async dequeue(nowMs: number = this.now()): Promise<WorkerRetryRecord | null> {
    const records = await this.load();
    let bestIdx = -1;
    let best: WorkerRetryRecord | undefined;
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!;
      if (record.nextRetryAt > nowMs) continue;
      if (
        best === undefined ||
        record.nextRetryAt < best.nextRetryAt ||
        (record.nextRetryAt === best.nextRetryAt && record.id < best.id)
      ) {
        best = record;
        bestIdx = i;
      }
    }
    if (best === undefined || bestIdx < 0) return null;

    records.splice(bestIdx, 1);
    await this.persist(records);
    return { ...best };
  }

  async ack(recordId: string): Promise<void> {
    const records = await this.load();
    const next = records.filter((r) => r.id !== recordId);
    if (next.length !== records.length) await this.persist(next);
  }

  async size(): Promise<number> {
    const records = await this.load();
    return records.length;
  }

  private async load(): Promise<WorkerRetryRecord[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as WorkerRetryRecord[];
      this.cache = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.cache = [];
      } else {
        throw err;
      }
    }
    return this.cache;
  }

  private async persist(records: WorkerRetryRecord[]): Promise<void> {
    this.cache = records;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(records), "utf8");
    await fs.rename(tmp, this.file);
  }
}

/** Build a fresh retry record for the attempt scheduled after a failure. */
export function makeRetryRecord(
  submission: SubmissionHandle,
  attempt: number,
  nextRetryAt: number,
  failure: SubmissionFailure,
  priorFailures: SubmissionFailure[] = [],
  now: number = Date.now(),
): WorkerRetryRecord {
  return {
    id: submission.submissionId,
    submission,
    attempt,
    nextRetryAt,
    lastError: failure.message,
    failures: [...priorFailures, failure],
    createdAt: now,
    updatedAt: now,
  };
}
