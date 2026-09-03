import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { SorobanRpcError } from "@orbital-stellar/pulse-core";

import {
  classifySubmissionError,
  isRetryableSubmissionFailure,
  RetryPolicy,
  MemoryWorkerRetryQueue,
  FileWorkerRetryQueue,
  MemoryWorkerDeadLetterStore,
  type SubmissionHandle,
  type WorkerDeadLetterInput,
} from "../src/index.js";

function submission(overrides: Partial<SubmissionHandle> = {}): SubmissionHandle {
  return {
    submissionId: "payroll-aug-2026",
    windowDeadlineMs: Date.now() + 60_000,
    ...overrides,
  };
}

describe("18.5 classification: retryable vs terminal", () => {
  it("treats infrastructure failures as retryable", () => {
    expect(classifySubmissionError(new Error("rpc timeout")).retryable).toBe(true);
    expect(classifySubmissionError(new Error("ETIMEDOUT")).retryable).toBe(true);
    expect(classifySubmissionError(new Error("tx bad seq")).retryable).toBe(true);
    expect(classifySubmissionError(new Error("tx_too_late")).retryable).toBe(true);
    expect(classifySubmissionError(new Error("tx_insufficient_fee")).retryable).toBe(true);
    expect(classifySubmissionError(new Error("rate limit exceeded")).retryable).toBe(true);
  });

  it("treats contract rejections as terminal", () => {
    const rejection = classifySubmissionError(
      new Error("contract invocation rejected: op_invalid"),
    );
    expect(rejection.retryable).toBe(false);
    expect(rejection.kind).toBe("contract_rejection");

    const auth = classifySubmissionError(new Error("unauthorized"));
    expect(auth.retryable).toBe(false);

    const unknown = classifySubmissionError(new Error("some opaque failure"));
    expect(unknown.retryable).toBe(false);
    expect(unknown.kind).toBe("unknown");
  });

  it("honors the SorobanRpcError retryable flag", () => {
    const retryable = new SorobanRpcError("boom", { code: "server", retryable: true });
    expect(isRetryableSubmissionFailure(retryable)).toBe(true);

    const terminal = new SorobanRpcError("nope", { code: "auth", retryable: false });
    expect(classifySubmissionError(terminal).retryable).toBe(false);
  });
});

describe("RetryPolicy", () => {
  it("schedules a retry on a retryable error using the shared pulse-core backoff", () => {
    const now = 1_000_000;
    const policy = new RetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: false,
      now: () => now,
    });
    // Delay for attempt 1 -> 2 is min(100 * 2^0, 10000) = 100.
    const decision = policy.decide(1, new Error("rpc timeout"), submission());
    expect(decision).toMatchObject({ action: "retry", attempt: 2, nextRetryAt: now + 100 });
  });

  it("dead-letters immediately on a terminal (contract rejection) failure", () => {
    const policy = new RetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: false,
    });
    const decision = policy.decide(1, new Error("contract rejected"), submission());
    expect(decision).toMatchObject({ action: "deadletter", reason: "terminal" });
    if (decision.action === "deadletter") {
      expect(decision.failure.kind).toBe("contract_rejection");
    }
  });

  it("dead-letters once attempts are exhausted", () => {
    const policy = new RetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: false,
    });
    const decision = policy.decide(3, new Error("rpc timeout"), submission());
    expect(decision).toMatchObject({ action: "deadletter", reason: "max_attempts" });
  });

  it("stops retrying at the window boundary even when attempts remain", () => {
    const now = 1_000_000;
    const windowDeadlineMs = now + 50; // next retry (100ms out) would exceed it
    const policy = new RetryPolicy({
      maxAttempts: 10,
      initialDelayMs: 100,
      maxDelayMs: 10_000,
      jitter: false,
      now: () => now,
    });
    const decision = policy.decide(1, new Error("rpc timeout"), submission({ windowDeadlineMs }));
    expect(decision).toMatchObject({ action: "deadletter", reason: "window_expired" });
  });

  it("uses full jitter from pulse-core when enabled", () => {
    const policy = new RetryPolicy({
      maxAttempts: 5,
      initialDelayMs: 1000,
      maxDelayMs: 10_000,
      jitter: true,
      now: () => 0,
    });
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const d = policy.decide(1, new Error("rpc timeout"), submission({ windowDeadlineMs: 1e12 }));
      if (d.action === "retry") delays.add(d.nextRetryAt); // now=0 so nextRetryAt == delay
    }
    // Full jitter must be non-deterministic across runs.
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe("WorkerDeadLetterStore records the full failure chain", () => {
  it("stores every failure and marks the entry as a miss", async () => {
    const store = new MemoryWorkerDeadLetterStore();
    const failures = [
      classifySubmissionError(new Error("rpc timeout")),
      classifySubmissionError(new Error("tx bad seq")),
      classifySubmissionError(new Error("rate limit")),
    ];
    const id = await store.record({
      submissionId: "payroll-aug-2026",
      error: "rate limit",
      attempts: 3,
      failures,
      outcome: "max_attempts",
      windowDeadlineMs: 1_000,
      miss: true,
    } satisfies WorkerDeadLetterInput);

    const entry = await store.get(id);
    expect(entry).not.toBeNull();
    expect(entry!.miss).toBe(true);
    expect(entry!.attempts).toBe(3);
    expect(entry!.failures).toHaveLength(3);
    expect(entry!.failures.map((f) => f.kind)).toEqual([
      "rpc_timeout",
      "ledger_contention",
      "rate_limit",
    ]);
    // Visible as a miss to 19.1.
    const misses = await store.list({ miss: true });
    expect(misses).toHaveLength(1);
  });
});

describe("Retry state survives process restart", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "worker-retry-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resumes a pending retry chain after the queue is reloaded from disk", async () => {
    const now = 1_000_000;
    const clock = vi.fn(() => now);

    // First "process": enqueue a pending retry.
    const queue1 = new FileWorkerRetryQueue({ dir, now: clock });
    await queue1.enqueue({
      id: "payroll-aug-2026",
      submission: submission({ windowDeadlineMs: now + 1_000_000 }),
      attempt: 2,
      nextRetryAt: now + 5_000,
      failures: [classifySubmissionError(new Error("rpc timeout"))],
      createdAt: now,
      updatedAt: now,
    });
    expect(await queue1.size()).toBe(1);

    // Simulate a restart: a brand new queue instance reads the same file.
    const queue2 = new FileWorkerRetryQueue({ dir, now: clock });
    expect(await queue2.size()).toBe(1);

    const due = await queue2.dequeue(now + 5_001);
    expect(due).not.toBeNull();
    expect(due!.attempt).toBe(2);
    expect(due!.failures).toHaveLength(1);

    // Acknowledge success and it is gone after reload too.
    await queue2.ack(due!.id);
    const queue3 = new FileWorkerRetryQueue({ dir, now: clock });
    expect(await queue3.size()).toBe(0);
  });

  it("MemoryWorkerRetryQueue behaves as the same contract reference", async () => {
    const now = 1_000_000;
    const q = new MemoryWorkerRetryQueue({ now: () => now });
    await q.enqueue({
      id: "s1",
      submission: submission(),
      attempt: 2,
      nextRetryAt: now + 1,
      failures: [],
      createdAt: now,
      updatedAt: now,
    });
    const rec = await q.dequeue(now + 1);
    expect(rec?.id).toBe("s1");
    await q.ack("s1");
    expect(await q.size()).toBe(0);
  });
});
