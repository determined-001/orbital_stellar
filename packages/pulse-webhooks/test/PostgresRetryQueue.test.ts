import { describe, it, expect, beforeEach } from "vitest";
import { PostgresRetryQueue } from "../src/PostgresRetryQueue.js";
import type { PgLike } from "../src/PostgresRetryQueue.js";
import type { RetryRecord } from "../src/RetryQueue.js";

interface StoredRow {
  id: string;
  webhook_id: string;
  payload: unknown;
  attempt_count: number;
  next_retry_at: Date;
  created_at: Date;
  url: string;
  event: unknown;
  attempt: number;
  last_error: string | null;
  metadata: unknown;
  locked: boolean;
}

class SimulatedPg implements PgLike {
  private rows: StoredRow[] = [];
  private nextFakeId = 1;
  private mutex = Promise.resolve();

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    const prev = this.mutex;
    this.mutex = prev.then(() => wait);
    await prev;
    try {
      return await fn();
    } finally {
      release!();
    }
  }

  async query<T = any>(
    text: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[] }> {
    const normalized = text.replace(/\s+/g, " ").trim();

    if (normalized.startsWith("INSERT INTO")) {
      return this.handleInsert(params) as any;
    }

    if (normalized.startsWith("WITH")) {
      return this.handleDequeue() as any;
    }

    if (normalized.startsWith("DELETE")) {
      return this.handleDelete(text) as any;
    }

    if (normalized.startsWith("SELECT COUNT")) {
      return { rows: [{ count: this.rows.length }] } as any;
    }

    throw new Error(`Unhandled query: ${text}`);
  }

  private handleInsert(params: unknown[]) {
    const [
      id,
      webhookId,
      payloadStr,
      attemptCount,
      nextRetryAtMs,
      createdAtMs,
      url,
      eventStr,
      attempt,
      lastError,
      metadataStr,
    ] = params;

    const resolvedId =
      (id as string) ?? `fake_${this.nextFakeId++}`;

    const exists = this.rows.some((r) => r.id === resolvedId);
    if (exists) return { rows: [] };

    const row: StoredRow = {
      id: resolvedId,
      webhook_id: webhookId as string,
      payload: JSON.parse(payloadStr as string),
      attempt_count: attemptCount as number,
      next_retry_at: new Date(nextRetryAtMs as number),
      created_at: createdAtMs !== null ? new Date(createdAtMs as number) : new Date(),
      url: url as string,
      event: JSON.parse(eventStr as string),
      attempt: attempt as number,
      last_error: (lastError as string) ?? null,
      metadata: metadataStr !== null ? JSON.parse(metadataStr as string) : null,
      locked: false,
    };
    this.rows.push(row);
    return { rows: [] };
  }

  private async handleDequeue() {
    return this.withLock(async () => {
      const now = new Date();

      const idx = this.rows.findIndex(
        (r) => r.next_retry_at <= now && !r.locked,
      );
      if (idx === -1) return { rows: [] };

      const row = this.rows[idx];
      row.locked = true;
      this.rows.splice(idx, 1);

      return {
        rows: [
          {
            id: row.id,
            webhook_id: row.webhook_id,
            payload: row.payload,
            attempt_count: row.attempt_count,
            next_retry_at: row.next_retry_at,
            created_at: row.created_at,
            url: row.url,
            event: row.event,
            attempt: row.attempt,
            last_error: row.last_error,
            metadata: row.metadata,
          },
        ],
      };
    });
  }

  private handleDelete(text: string) {
    if (text.includes("ORDER BY created_at DESC")) {
      return this.handleEvictNewest();
    }
    return { rows: [] };
  }

  private handleEvictNewest() {
    if (this.rows.length === 0) return { rows: [] };

    this.rows.sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    );
    const row = this.rows.shift()!;

    return {
      rows: [
        {
          id: row.id,
          webhook_id: row.webhook_id,
          payload: row.payload,
          attempt_count: row.attempt_count,
          next_retry_at: row.next_retry_at,
          created_at: row.created_at,
          url: row.url,
          event: row.event,
          attempt: row.attempt,
          last_error: row.last_error,
          metadata: row.metadata,
        },
      ],
    };
  }
}

function makeRecord(overrides: Partial<RetryRecord> = {}): RetryRecord {
  return {
    webhookId: "wh_test",
    payload: { type: "test" },
    attemptCount: 0,
    nextRetryAt: Date.now() - 1000,
    createdAt: Date.now(),
    url: "https://example.com/webhook",
    event: { original: "event" },
    attempt: 1,
    ...overrides,
  };
}

describe("PostgresRetryQueue", () => {
  let pg: SimulatedPg;
  let queue: PostgresRetryQueue;

  beforeEach(() => {
    pg = new SimulatedPg();
    queue = new PostgresRetryQueue(pg);
  });

  describe("enqueue", () => {
    it("inserts a record", async () => {
      await queue.enqueue(makeRecord());
      expect(await queue.size()).toBe(1);
    });

    it("is idempotent — same id inserts only one row", async () => {
      const record = makeRecord({ id: "dup" });
      await queue.enqueue(record);
      await queue.enqueue(record);
      expect(await queue.size()).toBe(1);
    });

    it("allows records with different webhookIds", async () => {
      await queue.enqueue(makeRecord({ webhookId: "a" }));
      await queue.enqueue(makeRecord({ webhookId: "b" }));
      expect(await queue.size()).toBe(2);
    });
  });

  describe("dequeue", () => {
    it("returns a due record", async () => {
      await queue.enqueue(makeRecord());
      const record = await queue.dequeue();
      expect(record).not.toBeUndefined();
      expect(record!.webhookId).toBe("wh_test");
    });

    it("returns undefined when no records are due", async () => {
      await queue.enqueue(makeRecord({ nextRetryAt: Date.now() + 60_000 }));
      const record = await queue.dequeue();
      expect(record).toBeUndefined();
    });

    it("removes the dequeued record from the queue", async () => {
      await queue.enqueue(makeRecord());
      await queue.dequeue();
      expect(await queue.size()).toBe(0);
    });
  });

  describe("evictNewest", () => {
    it("returns the most recently created record and removes it", async () => {
      await queue.enqueue(makeRecord({ createdAt: 1000 }));
      await queue.enqueue(makeRecord({ createdAt: 2000 }));

      const evicted = await queue.evictNewest();
      expect(evicted).not.toBeUndefined();
      expect(evicted!.createdAt).toBe(2000);
      expect(await queue.size()).toBe(1);
    });

    it("returns undefined when the table is empty", async () => {
      const result = await queue.evictNewest();
      expect(result).toBeUndefined();
    });
  });

  describe("size", () => {
    it("returns 0 for an empty queue", async () => {
      expect(await queue.size()).toBe(0);
    });

    it("reflects the count after enqueue and dequeue", async () => {
      await queue.enqueue(makeRecord());
      await queue.enqueue(makeRecord());
      expect(await queue.size()).toBe(2);

      await queue.dequeue();
      expect(await queue.size()).toBe(1);
    });
  });

  describe("multi-consumer behavior", () => {
    it("concurrent dequeue on one due record: exactly one consumer gets it", async () => {
      await queue.enqueue(makeRecord());
      expect(await queue.size()).toBe(1);

      const results = await Promise.all([
        queue.dequeue(),
        queue.dequeue(),
        queue.dequeue(),
      ]);

      const successes = results.filter((r) => r !== undefined);
      expect(successes.length).toBe(1);
    });

    it("concurrent dequeue on multiple records: each gets a distinct record", async () => {
      await queue.enqueue(makeRecord({ id: "r1" }));
      await queue.enqueue(makeRecord({ id: "r2" }));
      expect(await queue.size()).toBe(2);

      const results = await Promise.all([
        queue.dequeue(),
        queue.dequeue(),
      ]);

      const records = results.filter((r) => r !== undefined);
      expect(records.length).toBe(2);
      expect(records[0]!.id).not.toBe(records[1]!.id);
    });

    it("exactly-once: N consumers on N records each get one unique record", async () => {
      const count = 10;
      for (let i = 0; i < count; i++) {
        await queue.enqueue(makeRecord({ id: `r${i}` }));
      }

      const consumers = Array.from({ length: count }, () => queue.dequeue());
      const results = await Promise.all(consumers);

      const records = results.filter((r) => r !== undefined);
      expect(records.length).toBe(count);

      const ids = new Set(records.map((r) => r!.id));
      expect(ids.size).toBe(count);
    });
  });
});
