import { describe, it, expect, beforeEach } from "vitest";
import { PostgresRetryQueue } from "../src/PostgresRetryQueue.js";
import type { PgLike } from "../src/PostgresRetryQueue.js";

class MockPg implements PgLike {
  public rows: any[] = [];
  public queryCount = 0;
  private nextId = 1;

  async query<T = any>(text: string, params: any[] = []): Promise<{ rows: T[] }> {
    // Add small artificial delay to simulate network/db latency and force async overlap
    await new Promise(resolve => setTimeout(resolve, Math.random() * 5));

    this.queryCount++;
    const normalizedQuery = text.replace(/\s+/g, " ").trim();

    // 1. INSERT query
    if (normalizedQuery.includes("INSERT INTO")) {
      const [url, eventStr, attempt, nextAttemptAt] = params;
      const row = {
        id: this.nextId++,
        url,
        event: typeof eventStr === "string" ? JSON.parse(eventStr) : eventStr,
        attempt,
        next_attempt_at: nextAttemptAt,
        locked_until: null as Date | null,
      };
      this.rows.push(row);
      return { rows: [] };
    }

    // 2. DELETE query
    if (normalizedQuery.includes("DELETE FROM")) {
      const [id] = params;
      this.rows = this.rows.filter(r => r.id !== id);
      return { rows: [] };
    }

    // 3. UPDATE query (fail retry)
    if (normalizedQuery.includes("UPDATE") && normalizedQuery.includes("SET attempt = attempt + 1")) {
      const [id, nextAttemptAt] = params;
      const row = this.rows.find(r => r.id === id);
      if (row) {
        row.attempt += 1;
        row.next_attempt_at = nextAttemptAt;
        row.locked_until = null;
      }
      return { rows: [] };
    }

    // 4. DEQUEUE CTE query (Select, lock and lease)
    if (normalizedQuery.includes("WITH next_jobs") || normalizedQuery.includes("FOR UPDATE SKIP LOCKED")) {
      const [limit, lockedUntil] = params;
      const now = new Date();

      // Find eligible jobs: next_attempt_at <= now AND (locked_until is null OR locked_until < now)
      const eligible = this.rows
        .filter(r => {
          const isDue = new Date(r.next_attempt_at) <= now;
          const isNotLocked = !r.locked_until || new Date(r.locked_until) < now;
          return isDue && isNotLocked;
        })
        .slice(0, limit);

      // Lock them atomically
      for (const row of eligible) {
        row.locked_until = lockedUntil;
      }

      return { rows: eligible as unknown as T[] };
    }

    throw new Error(`Unhandled query in MockPg: ${text}`);
  }
}

describe("PostgresRetryQueue", () => {
  let pg: MockPg;
  let queue: PostgresRetryQueue;

  beforeEach(() => {
    pg = new MockPg();
    queue = new PostgresRetryQueue(pg);
  });

  it("should enqueue a job correctly", async () => {
    const nextAttempt = new Date();
    await queue.enqueue("https://example.com/webhook", { type: "payment.received" }, 1, nextAttempt);

    expect(pg.rows.length).toBe(1);
    expect(pg.rows[0].url).toBe("https://example.com/webhook");
    expect(pg.rows[0].event).toEqual({ type: "payment.received" });
    expect(pg.rows[0].attempt).toBe(1);
    expect(pg.rows[0].next_attempt_at).toEqual(nextAttempt);
    expect(pg.rows[0].locked_until).toBeNull();
  });

  it("should dequeue due jobs and apply a visibility lock lease", async () => {
    const dueTime = new Date(Date.now() - 1000); // 1s ago
    await queue.enqueue("https://example.com/webhook1", { id: 1 }, 1, dueTime);
    await queue.enqueue("https://example.com/webhook2", { id: 2 }, 1, dueTime);

    // Dequeue 1 job
    const jobs = await queue.dequeue(1, 10000);
    expect(jobs.length).toBe(1);
    expect(jobs[0].url).toBe("https://example.com/webhook1");

    // The dequeued job should have its locked_until set in the db
    const row1 = pg.rows.find(r => r.id === jobs[0].id);
    expect(row1.locked_until).toBeInstanceOf(Date);
    expect(row1.locked_until.getTime()).toBeGreaterThan(Date.now());

    // The other job remains unlocked
    const row2 = pg.rows.find(r => r.id !== jobs[0].id);
    expect(row2.locked_until).toBeNull();

    // Dequeueing again should only return the remaining unlocked job
    const jobs2 = await queue.dequeue(1, 10000);
    expect(jobs2.length).toBe(1);
    expect(jobs2[0].url).toBe("https://example.com/webhook2");
  });

  it("should complete a job by deleting it", async () => {
    const dueTime = new Date(Date.now() - 1000);
    await queue.enqueue("https://example.com/webhook", { id: 1 }, 1, dueTime);

    const jobs = await queue.dequeue(1, 10000);
    expect(pg.rows.length).toBe(1);

    await queue.complete(jobs[0].id);
    expect(pg.rows.length).toBe(0);
  });

  it("should fail a job and reschedule it with attempt incremented", async () => {
    const dueTime = new Date(Date.now() - 1000);
    await queue.enqueue("https://example.com/webhook", { id: 1 }, 1, dueTime);

    const jobs = await queue.dequeue(1, 10000);
    const nextRetry = new Date(Date.now() + 5000);

    await queue.fail(jobs[0].id, nextRetry);
    expect(pg.rows.length).toBe(1);
    expect(pg.rows[0].attempt).toBe(2);
    expect(pg.rows[0].next_attempt_at).toEqual(nextRetry);
    expect(pg.rows[0].locked_until).toBeNull(); // lock lease is cleared
  });

  it("should delete a job if fail is called with null nextAttemptAt (retries exhausted)", async () => {
    const dueTime = new Date(Date.now() - 1000);
    await queue.enqueue("https://example.com/webhook", { id: 1 }, 3, dueTime);

    const jobs = await queue.dequeue(1, 10000);
    await queue.fail(jobs[0].id, null);

    expect(pg.rows.length).toBe(0);
  });

  it("should support safe multi-consumer dequeue (exactly once per record)", async () => {
    const dueTime = new Date(Date.now() - 1000);
    const numJobs = 50;

    // Enqueue 50 due jobs
    for (let i = 0; i < numJobs; i++) {
      await queue.enqueue(`https://example.com/webhook/${i}`, { index: i }, 1, dueTime);
    }

    // 5 concurrent consumers polling simultaneously
    const numConsumers = 5;
    const dequeuedJobs: any[][] = [];

    const consumers = Array.from({ length: numConsumers }).map(async () => {
      // Each consumer dequeues up to 10 jobs
      const jobs = await queue.dequeue(10, 30000);
      dequeuedJobs.push(jobs);
    });

    await Promise.all(consumers);

    // Verify exactly-once dequeueing behavior across all concurrent consumers
    const allDequeuedIds = dequeuedJobs.flat().map(j => j.id);
    
    // We expect exactly 50 total dequeued jobs
    expect(allDequeuedIds.length).toBe(numJobs);

    // All dequeued IDs must be unique (no duplicate job was picked up by different consumers)
    const uniqueIds = new Set(allDequeuedIds);
    expect(uniqueIds.size).toBe(numJobs);

    // Every single database row should now be locked
    for (const row of pg.rows) {
      expect(row.locked_until).toBeInstanceOf(Date);
      expect(row.locked_until.getTime()).toBeGreaterThan(Date.now());
    }
  });
});
