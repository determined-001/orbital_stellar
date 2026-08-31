import {
  WorkerStateStore,
  WORKER_STATE_SCHEMA_VERSION,
  type WorkerState,
  type RegisterWorkerInput,
  type AppendFireRecordInput,
  type WriteClaimInput,
  type ReleaseClaimInput,
} from "./WorkerStateStore.js";

/**
 * In-memory implementation of {@link WorkerStateStore}.
 *
 * State is lost on process exit. Intended for testing and local development.
 * All operations are synchronous under the hood but return Promises to
 * satisfy the interface.
 */
export class MemoryWorkerStateStore extends WorkerStateStore {
  readonly #store = new Map<string, WorkerState>();

  async getWorker(workerId: string): Promise<WorkerState | null> {
    return this.#store.get(workerId) ?? null;
  }

  async registerWorker(input: RegisterWorkerInput): Promise<WorkerState> {
    const existing = this.#store.get(input.workerId);
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
    this.#store.set(input.workerId, state);
    return state;
  }

  async appendFireRecord(input: AppendFireRecordInput): Promise<WorkerState> {
    const existing = this.#store.get(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      lastFiredWindowStart: input.record.windowStart,
      lastFiredWindowEnd: input.record.windowEnd,
      fireHistory: [...existing.fireHistory, input.record],
    };
    this.#store.set(input.workerId, updated);
    return updated;
  }

  async writeClaim(input: WriteClaimInput): Promise<WorkerState> {
    const existing = this.#store.get(input.workerId);
    if (!existing) {
      throw new Error(
        `WorkerStateStore: worker "${input.workerId}" is not registered. Call registerWorker first.`,
      );
    }

    const now = new Date().toISOString();
    // Replace any existing claim for the same windowId or append
    const withoutExisting = existing.activeClaims.filter(
      (c) => c.windowId !== input.claim.windowId,
    );
    const updated: WorkerState = {
      ...existing,
      updatedAt: now,
      activeClaims: [...withoutExisting, input.claim],
    };
    this.#store.set(input.workerId, updated);
    return updated;
  }

  async releaseClaim(input: ReleaseClaimInput): Promise<WorkerState> {
    const existing = this.#store.get(input.workerId);
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
    this.#store.set(input.workerId, updated);
    return updated;
  }

  override async getAllWorkers(): Promise<WorkerState[]> {
    return Array.from(this.#store.values());
  }
}
