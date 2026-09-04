/**
 * In-memory fakes for the narrow client interfaces the remote
 * WorkerStateStore adapters call (`PgLike`, `RedisLike`).
 *
 * They mirror RedisRetryQueue.test.ts's `MockRedis` and
 * PostgresRetryQueue.test.ts's `MockPg`: each re-implements the intended
 * storage semantics over plain Maps so the full conformance suite can run
 * against the Postgres and Redis backends without a live server. Because
 * the same suite also runs against the Memory reference implementation,
 * this proves the remote adapters agree with it — the property that
 * matters for a state store.
 *
 * These fakes intentionally use each adapter's `query`/`get`/`set` surface
 * (not its private internals), so behaviour is verified against the real
 * SQL/command shape, not just call recording.
 */

import type { PgLike } from "../src/PostgresWorkerStateStore.js";
import type { RedisLike } from "../src/RedisWorkerStateStore.js";

type PgRow = Record<string, unknown>;
type PgResult = { rows: PgRow[] };

type RegistrationRow = {
  worker_id: string;
  registered_at: string;
  updated_at: string;
  last_fired_window_start: string | null;
  last_fired_window_end: string | null;
  metadata: string | null;
};

type FireHistoryRow = {
  window_start: string;
  window_end: string;
  fired_at: string;
  payload: string | null;
};

type ClaimRow = {
  window_id: string;
  worker_id: string;
  claimed_at: string;
  expires_at: string;
};

/**
 * In-memory simulation of the three `worker_state_store` tables, dispatching
 * on the SQL fragments PostgresWorkerStateStore actually issues.
 */
export class MockPg implements PgLike {
  readonly registrations = new Map<string, RegistrationRow>();
  readonly fireHistory = new Map<string, FireHistoryRow[]>();
  readonly claims = new Map<string, ClaimRow[]>();

  async query(text: string, params: unknown[] = []): Promise<PgResult> {
    // ── #load: registration SELECT ──────────────────────────────────────────
    if (text.startsWith("SELECT worker_id, registered_at, updated_at")) {
      const [workerId] = params as [string];
      const row = this.registrations.get(workerId);
      return {
        rows: row
          ? [
              {
                ...row,
                // jsonb column is returned by pg as a decoded object
                metadata: row.metadata === null ? null : (JSON.parse(row.metadata) as unknown),
              },
            ]
          : [],
      };
    }

    if (text.startsWith("SELECT window_start, window_end, fired_at, payload")) {
      const [workerId] = params as [string];
      const rows = (this.fireHistory.get(workerId) ?? []).map((r) => ({ ...r }));
      rows.sort((a, b) => (a.fired_at < b.fired_at ? -1 : a.fired_at > b.fired_at ? 1 : 0));
      return { rows };
    }

    if (text.startsWith("SELECT window_id, worker_id, claimed_at, expires_at")) {
      const [workerId] = params as [string];
      return { rows: (this.claims.get(workerId) ?? []).map((r) => ({ ...r })) };
    }

    if (text.startsWith("SELECT worker_id FROM worker_registrations")) {
      const rows = [...this.registrations.values()]
        .sort((a, b) => (a.registered_at < b.registered_at ? -1 : 1))
        .map((r) => ({ worker_id: r.worker_id }));
      return { rows };
    }

    // ── registerWorker: INSERT … ON CONFLICT DO NOTHING ────────────────────
    if (text.startsWith("INSERT INTO worker_registrations")) {
      const [workerId, registeredAt, updatedAt, metadata] = params as [
        string,
        string,
        string,
        string,
      ];
      if (!this.registrations.has(workerId)) {
        this.registrations.set(workerId, {
          worker_id: workerId,
          registered_at: registeredAt,
          updated_at: updatedAt,
          last_fired_window_start: null,
          last_fired_window_end: null,
          metadata,
        });
      }
      return { rows: [] };
    }

    // ── appendFireRecord / writeClaim / releaseClaim: registration existence ──
    if (text.includes("SELECT 1 FROM worker_registrations WHERE worker_id")) {
      const [workerId] = params as [string];
      return { rows: this.registrations.has(workerId) ? [{ "?column?": 1 }] : [] };
    }

    if (text.startsWith("INSERT INTO worker_fire_history")) {
      const [workerId, windowStart, windowEnd, firedAt, payload] = params as [
        string,
        string,
        string,
        string,
        string | null,
      ];
      const list = this.fireHistory.get(workerId) ?? [];
      list.push({ window_start: windowStart, window_end: windowEnd, fired_at: firedAt, payload });
      this.fireHistory.set(workerId, list);
      return { rows: [] };
    }

    if (text.startsWith("INSERT INTO worker_claims")) {
      const [windowId, workerId, claimedAt, expiresAt] = params as [string, string, string, string];
      const list = this.claims.get(workerId) ?? [];
      const idx = list.findIndex((r) => r.window_id === windowId);
      const next: ClaimRow = {
        window_id: windowId,
        worker_id: workerId,
        claimed_at: claimedAt,
        expires_at: expiresAt,
      };
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      this.claims.set(workerId, list);
      return { rows: [] };
    }

    // ── UPDATE worker_registrations (append fire record scalars) ───────────
    if (text.includes("last_fired_window_start = $2")) {
      const [updatedAt, windowStart, windowEnd, workerId] = params as [
        string,
        string,
        string,
        string,
      ];
      const row = this.registrations.get(workerId);
      if (row) {
        row.updated_at = updatedAt;
        row.last_fired_window_start = windowStart;
        row.last_fired_window_end = windowEnd;
      }
      return { rows: [] };
    }

    // ── UPDATE worker_registrations SET updated_at (write/release claim) ───
    if (text.startsWith("UPDATE worker_registrations SET updated_at")) {
      const [updatedAt, workerId] = params as [string, string];
      const row = this.registrations.get(workerId);
      if (row) row.updated_at = updatedAt;
      return { rows: [] };
    }

    // ── releaseClaim: DELETE FROM worker_claims ─────────────────────────────
    if (text.startsWith("DELETE FROM worker_claims")) {
      const [workerId, windowId] = params as [string, string];
      const list = this.claims.get(workerId) ?? [];
      this.claims.set(
        workerId,
        list.filter((r) => r.window_id !== windowId),
      );
      return { rows: [] };
    }

    // ── ping ────────────────────────────────────────────────────────────────
    if (text.trim() === "SELECT 1") {
      return { rows: [{ "?column?": 1 }] };
    }

    throw new Error(`MockPg: unrecognized query: ${text}`);
  }
}

/**
 * In-memory simulation of the narrow `RedisLike` interface backed by a plain
 * Map, keyed by the full redis key (including the `orbital:worker:` prefix).
 */
export class MockRedis implements RedisLike {
  readonly store = new Map<string, string>();
  private callCount = 0;

  async get(key: string): Promise<string | null> {
    this.callCount++;
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.callCount++;
    this.store.set(key, value);
    return "OK";
  }

  async del(...keys: string[]): Promise<unknown> {
    this.callCount++;
    let removed = 0;
    for (const key of keys) {
      if (this.store.delete(key)) removed++;
    }
    return removed;
  }

  async keys(pattern: string): Promise<string[]> {
    this.callCount++;
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    const re = new RegExp(`^${escaped}$`);
    return [...this.store.keys()].filter((k) => re.test(k));
  }

  /** Number of commands issued — lets tests assert a fresh store is used per case. */
  get commands(): number {
    return this.callCount;
  }
}
