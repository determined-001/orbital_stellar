import { randomUUID } from "crypto";

import type { SubmissionFailure, SubmissionFailureKind } from "./errors.js";

/**
 * Payload recorded when a submission's retries are exhausted (or it hit a
 * terminal failure / window boundary). Unlike the webhook dead-letter store,
 * a worker dead-letter preserves the **entire failure chain** so an operator
 * can see every retry attempt that led here, not just the last error.
 */
export type WorkerDeadLetterInput = {
  submissionId: string;
  /** Final error message (last entry of `failures`). */
  error: string;
  /** Total attempts made, including the original. */
  attempts: number;
  /** Every classified failure, in order, from first attempt to last. */
  failures: SubmissionFailure[];
  /** Why the submission stopped retrying. */
  outcome: "terminal" | "window_expired" | "max_attempts";
  /** Window the submission was bound to (epoch ms). */
  windowDeadlineMs: number;
  /**
   * Dead-lettered fires are *misses* from the operator's perspective: the
   * scheduled action did not happen. 19.1 surfaces these as misses rather than
   * silence, so we record the signal explicitly rather than inferring it.
   */
  miss: boolean;
  /** Classification of the final failure, if known. */
  terminalKind?: SubmissionFailureKind;
  failedAt?: number;
  metadata?: Record<string, unknown>;
};

export type WorkerDeadLetterEntry = WorkerDeadLetterInput & {
  id: string;
  timestamp: number;
  replayedAt?: number | null;
};

export type WorkerDeadLetterFilter = {
  submissionId?: string;
  outcome?: WorkerDeadLetterInput["outcome"];
  terminalKind?: SubmissionFailureKind;
  /** Restrict to misses only (default: include all). */
  miss?: boolean;
  since?: number;
  until?: number;
  limit?: number;
};

/** Called by {@link WorkerDeadLetterStore.replay} to re-submit a stored failure. */
export type WorkerReplayHandler = (entry: WorkerDeadLetterEntry) => Promise<void>;

/**
 * Store for terminal worker submission failures. Implementations persist the
 * full failure chain and let operators inspect, filter by outcome/kind, replay,
 * and delete entries.
 */
export interface WorkerDeadLetterStore {
  record(input: WorkerDeadLetterInput): Promise<string>;
  get(id: string): Promise<WorkerDeadLetterEntry | null>;
  list(filter?: WorkerDeadLetterFilter): Promise<WorkerDeadLetterEntry[]>;
  replay(id: string): Promise<void>;
  delete(id: string): Promise<boolean>;
}

export type MemoryWorkerDeadLetterStoreOptions = {
  maxEntries?: number;
  replay?: WorkerReplayHandler;
};

const DEFAULT_MAX_ENTRIES = 1000;

/**
 * In-memory {@link WorkerDeadLetterStore} with FIFO eviction. Suitable for
 * tests and single-process operators; pair with a durable backing store
 * (Postgres, Redis) for multi-process deployments.
 */
export class MemoryWorkerDeadLetterStore implements WorkerDeadLetterStore {
  private readonly maxEntries: number;
  private replayHandler?: WorkerReplayHandler;
  private readonly entries = new Map<string, WorkerDeadLetterEntry>();

  constructor(options: MemoryWorkerDeadLetterStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.replayHandler = options.replay;
  }

  setReplayHandler(handler: WorkerReplayHandler): void {
    this.replayHandler = handler;
  }

  async record(input: WorkerDeadLetterInput): Promise<string> {
    const timestamp = input.failedAt ?? Date.now();
    const id = `wdlq_${randomUUID()}`;
    this.entries.set(id, {
      ...input,
      id,
      timestamp,
      replayedAt: null,
    });
    this.evictOldestIfNeeded();
    return id;
  }

  async get(id: string): Promise<WorkerDeadLetterEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async list(filter: WorkerDeadLetterFilter = {}): Promise<WorkerDeadLetterEntry[]> {
    let results = [...this.entries.values()];

    if (filter.submissionId !== undefined) {
      results = results.filter((e) => e.submissionId === filter.submissionId);
    }
    if (filter.outcome !== undefined) {
      results = results.filter((e) => e.outcome === filter.outcome);
    }
    if (filter.terminalKind !== undefined) {
      results = results.filter((e) => e.terminalKind === filter.terminalKind);
    }
    if (filter.miss !== undefined) {
      results = results.filter((e) => e.miss === filter.miss);
    }
    if (filter.since !== undefined) {
      results = results.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter((e) => e.timestamp <= filter.until!);
    }

    results.sort((a, b) => a.timestamp - b.timestamp);
    if (filter.limit !== undefined) results = results.slice(0, filter.limit);
    return results;
  }

  async replay(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown worker dead-letter entry: ${id}`);
    if (!this.replayHandler) throw new Error("Worker dead-letter replay handler is not configured");
    await this.replayHandler(entry);
    entry.replayedAt = Date.now();
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  /** Number of stored entries (test/inspection helper). */
  size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private evictOldestIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestId = this.entries.keys().next().value;
      if (oldestId === undefined) break;
      this.entries.delete(oldestId);
    }
  }
}
