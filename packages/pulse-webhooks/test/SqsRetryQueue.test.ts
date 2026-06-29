import { describe, expect, it } from "vitest";

import {
  SqsRetryQueue,
  type SqsLike,
  type SqsRetryQueueOptions,
  type ReceiveMessageOutput,
  type SendMessageOutput,
  type DeleteMessageOutput,
  type SendMessageInput,
  type ReceiveMessageInput,
  type DeleteMessageInput,
} from "../src/SqsRetryQueue.js";
import type { RetryRecord } from "../src/RetryQueue.js";

// ---------------------------------------------------------------------------
// Minimal in-memory SQS mock
//
// Models standard-queue semantics:
//  - Messages are stored in insertion order.
//  - DelaySeconds shifts the message's earliest-visible timestamp.
//  - ReceiveMessage only returns messages whose visibleAt <= now.
//  - VisibilityTimeout temporarily hides a received message.
//  - DeleteMessage removes by ReceiptHandle.
// ---------------------------------------------------------------------------

type MockMessage = {
  receiptHandle: string;
  body: string;
  visibleAt: number;
  hiddenUntil: number | null;
};

class MockSqs implements SqsLike {
  private messages: MockMessage[] = [];
  private seq = 0;
  /** Injected clock; mutate in tests to advance time. */
  now: () => number;

  readonly sendCalls: SendMessageInput[] = [];
  readonly receiveCalls: ReceiveMessageInput[] = [];
  readonly deleteCalls: DeleteMessageInput[] = [];

  constructor(now?: () => number) {
    this.now = now ?? (() => 0);
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageOutput> {
    this.sendCalls.push(input);
    const delay = input.DelaySeconds ?? 0;
    this.messages.push({
      receiptHandle: `rh-${this.seq++}`,
      body: input.MessageBody,
      visibleAt: this.now() + delay * 1000,
      hiddenUntil: null,
    });
    return { MessageId: `msg-${this.seq}` };
  }

  async receiveMessage(input: ReceiveMessageInput): Promise<ReceiveMessageOutput> {
    this.receiveCalls.push(input);
    const now = this.now();
    const max = Math.min(input.MaxNumberOfMessages ?? 1, 10);
    const visTimeout = (input.VisibilityTimeout ?? 30) * 1000;

    const available = this.messages.filter(
      (m) => m.visibleAt <= now && (m.hiddenUntil === null || m.hiddenUntil <= now),
    );
    const batch = available.slice(0, max);

    for (const msg of batch) {
      msg.hiddenUntil = now + visTimeout;
    }

    if (batch.length === 0) return { Messages: [] };

    return {
      Messages: batch.map((m) => ({
        MessageId: m.receiptHandle,
        ReceiptHandle: m.receiptHandle,
        Body: m.body,
      })),
    };
  }

  async deleteMessage(input: DeleteMessageInput): Promise<DeleteMessageOutput> {
    this.deleteCalls.push(input);
    this.messages = this.messages.filter((m) => m.receiptHandle !== input.ReceiptHandle);
    return {};
  }

  /** Test helper: total remaining messages (including hidden). */
  messageCount(): number {
    return this.messages.length;
  }

  /** Test helper: messages currently visible at `atMs`. */
  visibleCount(atMs: number): number {
    return this.messages.filter(
      (m) => m.visibleAt <= atMs && (m.hiddenUntil === null || m.hiddenUntil <= atMs),
    ).length;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  id: string,
  nextRetryAt: number,
  overrides: Partial<RetryRecord> = {},
): RetryRecord {
  return {
    id,
    event: { id },
    url: "https://example.com/hook",
    attempt: 1,
    nextRetryAt,
    ...overrides,
  };
}

function makeQueue(sqs: MockSqs, overrides: Partial<SqsRetryQueueOptions> = {}): SqsRetryQueue {
  return new SqsRetryQueue(sqs, {
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789/test-queue",
    now: sqs.now,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SqsRetryQueue", () => {
  describe("enqueue", () => {
    it("sends the serialised record as the message body", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("r1", 0);

      await queue.enqueue(record);

      expect(sqs.sendCalls).toHaveLength(1);
      expect(JSON.parse(sqs.sendCalls[0]!.MessageBody)).toEqual(record);
    });

    it("sets DelaySeconds from nextRetryAt on a standard queue", async () => {
      const clock = 1_000;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      // nextRetryAt is 5 s in the future
      const record = makeRecord("r2", clock + 5_000);

      await queue.enqueue(record);

      expect(sqs.sendCalls[0]!.DelaySeconds).toBe(5);
    });

    it("clamps DelaySeconds to 900 s when nextRetryAt is far in the future", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("r3", clock + 9_999_999);

      await queue.enqueue(record);

      expect(sqs.sendCalls[0]!.DelaySeconds).toBe(900);
    });

    it("uses DelaySeconds of 0 when nextRetryAt is in the past", async () => {
      const clock = 10_000;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("r4", clock - 5_000);

      await queue.enqueue(record);

      expect(sqs.sendCalls[0]!.DelaySeconds).toBe(0);
    });

    it("sets MessageGroupId and MessageDeduplicationId for FIFO queues", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = new SqsRetryQueue(sqs, {
        queueUrl: "https://sqs.us-east-1.amazonaws.com/123/test.fifo",
        messageGroupId: "payments",
        now: sqs.now,
      });
      const record = makeRecord("fifo-1", 0);

      await queue.enqueue(record);

      const call = sqs.sendCalls[0]!;
      expect(call.MessageGroupId).toBe("payments");
      expect(call.MessageDeduplicationId).toBe("fifo-1");
      // FIFO queues do not support DelaySeconds
      expect(call.DelaySeconds).toBeUndefined();
    });

    it("throws when record.id is empty", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = makeQueue(sqs);

      await expect(queue.enqueue(makeRecord("", 0))).rejects.toThrow("RetryRecord.id is required");
    });

    it("throws when record.nextRetryAt is not finite", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = makeQueue(sqs);

      await expect(queue.enqueue(makeRecord("bad", NaN))).rejects.toThrow(
        "RetryRecord.nextRetryAt must be a finite timestamp",
      );
    });
  });

  describe("dequeue", () => {
    it("returns null when the queue is empty", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = makeQueue(sqs);

      expect(await queue.dequeue()).toBeNull();
    });

    it("returns null when no message is visible yet", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      // Message not yet visible (DelaySeconds = 5)
      await queue.enqueue(makeRecord("r1", clock + 5_000));

      // Still at t=0; message is delayed
      expect(await queue.dequeue()).toBeNull();
    });

    it("returns a record once its delay elapses", async () => {
      let clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("r1", clock + 2_000);

      await queue.enqueue(record);

      clock = 2_000;
      const out = await queue.dequeue();
      expect(out).toEqual(record);
    });

    it("passes VisibilityTimeout to SQS receive", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs, { visibilityTimeoutMs: 60_000 });
      await queue.enqueue(makeRecord("r1", 0));

      await queue.dequeue();

      expect(sqs.receiveCalls[0]!.VisibilityTimeout).toBe(60);
    });
  });

  describe("ack", () => {
    it("deletes the SQS message so it is never redelivered", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("r1", 0);

      await queue.enqueue(record);
      await queue.dequeue();

      expect(sqs.messageCount()).toBe(1); // hidden, not deleted yet

      await queue.ack("r1");

      expect(sqs.messageCount()).toBe(0);
      expect(sqs.deleteCalls).toHaveLength(1);
    });

    it("is a no-op when the record is not in-flight", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = makeQueue(sqs);

      await expect(queue.ack("unknown-id")).resolves.toBeUndefined();
      expect(sqs.deleteCalls).toHaveLength(0);
    });
  });

  describe("nack", () => {
    it("re-enqueues the record with the given delay and deletes the original", async () => {
      let clock = 1_000;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs, { visibilityTimeoutMs: 30_000 });
      const record = makeRecord("r1", clock, { attempt: 1 });

      await queue.enqueue(record);
      const dequeued = await queue.dequeue();
      expect(dequeued).toEqual(record);

      clock = 1_500;
      await queue.nack("r1", 3_000);

      // Original deleted + new send = 2 sendCalls total (enqueue + nack re-enqueue)
      expect(sqs.sendCalls).toHaveLength(2);
      const requeued = JSON.parse(sqs.sendCalls[1]!.MessageBody) as RetryRecord;
      expect(requeued.id).toBe("r1");
      expect(requeued.nextRetryAt).toBe(clock + 3_000);
      // Old message deleted
      expect(sqs.deleteCalls).toHaveLength(1);
    });

    it("is a no-op when the record is not in-flight", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = makeQueue(sqs);

      await expect(queue.nack("ghost", 1_000)).resolves.toBeUndefined();
      expect(sqs.deleteCalls).toHaveLength(0);
    });
  });

  describe("evictNewest", () => {
    it("removes and returns a record from the queue", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("evict-me", 0);

      await queue.enqueue(record);
      const evicted = await queue.evictNewest();

      expect(evicted).toEqual(record);
      expect(sqs.messageCount()).toBe(0);
    });

    it("returns null on an empty queue", async () => {
      const sqs = new MockSqs(() => 0);
      const queue = makeQueue(sqs);

      expect(await queue.evictNewest()).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("enqueue → dequeue → ack removes the message cleanly", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);
      const record = makeRecord("rt-1", 0, { attempt: 2, lastError: "HTTP 503" });

      await queue.enqueue(record);
      const received = await queue.dequeue();

      expect(received).toEqual(record);
      expect(sqs.messageCount()).toBe(1); // still present until acked

      await queue.ack("rt-1");

      expect(sqs.messageCount()).toBe(0);
      // A subsequent dequeue returns nothing
      expect(await queue.dequeue()).toBeNull();
    });

    it("message reappears after visibility timeout when not acked", async () => {
      let clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs, { visibilityTimeoutMs: 5_000 });
      const record = makeRecord("vis-1", 0);

      await queue.enqueue(record);
      await queue.dequeue(); // hides message for 5 s

      // Before timeout
      clock = 4_999;
      expect(await queue.dequeue()).toBeNull();

      // After timeout — SQS makes it visible again
      clock = 5_000;
      const redelivered = await queue.dequeue();
      expect(redelivered).toEqual(record);
    });

    it("enqueue → dequeue → nack → dequeue returns re-enqueued record after delay", async () => {
      let clock = 1_000;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs, { visibilityTimeoutMs: 60_000 });
      const record = makeRecord("nack-rt", 1_000);

      await queue.enqueue(record);
      await queue.dequeue();

      clock = 1_200;
      await queue.nack("nack-rt", 2_000); // re-queued at t=3200

      // Not yet visible
      clock = 3_199;
      expect(await queue.dequeue()).toBeNull();

      // Now visible
      clock = 3_200;
      const redelivered = await queue.dequeue();
      expect(redelivered?.id).toBe("nack-rt");
      expect(redelivered?.nextRetryAt).toBe(3_200);
    });
  });

  describe("size", () => {
    it("returns the count of locally-tracked in-flight records", async () => {
      const clock = 0;
      const sqs = new MockSqs(() => clock);
      const queue = makeQueue(sqs);

      await queue.enqueue(makeRecord("a", 0));
      await queue.enqueue(makeRecord("b", 0));

      expect(await queue.size()).toBe(0); // nothing dequeued yet

      await queue.dequeue();
      expect(await queue.size()).toBe(1);

      await queue.ack("a");
      expect(await queue.size()).toBe(0);
    });
  });
});
