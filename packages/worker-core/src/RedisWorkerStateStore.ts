import {
  WorkerStateStore,
  WORKER_STATE_SCHEMA_VERSION,
  type WorkerState,
  type RegisterWorkerInput,
  type AppendFireRecordInput,
  type WriteClaimInput,
  type ReleaseClaimInput,
  type WorkerFireRecord,
  type WorkerClaimRecord,
} from "./WorkerStateStore.js";

/**
 * Minimal Redis client interface required by {@link RedisWorkerStateStore}.
 * Compatible with `ioredis`, `node-redis`, or any client that exposes these
 * four methods.
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Redis implementation of {@link WorkerStateStore}.
 *
 * Each worker is stored as a single JSON blob at
 * `orbital:worker:<workerId>`. All mutations read-modify-write that blob.
 *
 * ## Concurrency trade-offs
 *
 * Redis is single-threaded, so individual `GET`/`SET` operations are atomic.
 * However, the read-modify-write pattern used here is **not** protected by
 * a distributed lock. In a multi-process deployment use the Postgres backend
 * for strict linearisability. The Redis backend is optimised for single-process
 * or low-contention scenarios (e.g. caching, development).
 *
 * ## Fire-history integrity
 *
 * Append-only semantics are enforced at the application layer: only
 * {@link appendFireRecord} mutates `fireHistory`, and it only ever pushes to
 * the array without truncating or modifying existing entries.
 *
 * ## Key layout
 *
 * | Key pattern                        | Content          |
 * |------------------------------------|------------------|
 * | `orbital:worker:<workerId>`        | WorkerState JSON |
 */
export class RedisWorkerStateStore extends WorkerStateStore {
  static readonly #PREFIX = "orbital:worker:";

  readonly #redis: RedisLike;

  constructor(redis: RedisLike) {
    super();
    this.#redis = redis;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  #key(workerId: string): string {
    return `${RedisWorkerStateStore.#PREFIX}${workerId}`;
  }

  async #read(workerId: string): Promise<WorkerState | null> {
    const raw = await this.#redis.get(this.#key(workerId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as WorkerState;
    } catch {
      return null;
    }
  }

  async #write(state: WorkerState): Promise<void> {
    await this.#redis.set(this.#key(state.workerId), JSON.stringify(state));
  }

  // -------------------------------------------------------------------------
  // WorkerStateStore interface
  // -------------------------------------------------------------------------

  async getWorker(workerId: string): Promise<WorkerState | null> {
    return this.#read(workerId);
  }

  async registerWorker(input: RegisterWorkerInput): Promise<WorkerState> {
    const existing = await this.#read(input.workerId);
    if (existing) return existing;

    const now = new Date().toISOString();
    const state: WorkerState = {
      schemaVersion: WORKER_STATE_SCHEMA_VERSION,
      workerId: input.workerId,
      registeredAt: input.registeredAt ?? now,
      updatedAt: now,
      lastFiredWindowStart: null,
      lastFiredWindowEnd: null,
      fireHistory: [],
      activeClaims: [],
      metadata: input.metadata ?? {},
    };
    await this.#write(state);
    return state;
  }

  async appendFireRecord(input: AppendFireRecordInput): Promise<WorkerState> {
    const existing = await this.#read(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    // Only push — never splice, truncate, or rewrite existing entries
    const newHistory: WorkerFireRecord[] = [...existing.fireHistory, input.record];

    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      lastFiredWindowStart: input.record.windowStart,
      lastFiredWindowEnd: input.record.windowEnd,
      fireHistory: newHistory,
    };
    await this.#write(updated);
    return updated;
  }

  async writeClaim(input: WriteClaimInput): Promise<WorkerState> {
    const existing = await this.#read(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const withoutExisting: WorkerClaimRecord[] = existing.activeClaims.filter(
      (c) => c.windowId !== input.claim.windowId,
    );
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      activeClaims: [...withoutExisting, input.claim],
    };
    await this.#write(updated);
    return updated;
  }

  async releaseClaim(input: ReleaseClaimInput): Promise<WorkerState> {
    const existing = await this.#read(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      activeClaims: existing.activeClaims.filter((c) => c.windowId !== input.windowId),
    };
    await this.#write(updated);
    return updated;
  }

  override async getAllWorkers(): Promise<WorkerState[]> {
    const allKeys = await this.#redis.keys(`${RedisWorkerStateStore.#PREFIX}*`);
    const results: WorkerState[] = [];
    for (const key of allKeys) {
      const raw = await this.#redis.get(key);
      if (raw === null) continue;
      try {
        results.push(JSON.parse(raw) as WorkerState);
      } catch {
        // skip corrupted entries
      }
    }
    return results;
  }
}
