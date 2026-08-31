/**
 * Pluggable durable store for worker registration, fire history, last-fired
 * windows, and claim records.
 *
 * The state schema is a **data contract** under STABILITY.md: a minor-version
 * upgrade MUST NOT lose fire history, because that history is the input to
 * the reputation score in phase 19.x.
 *
 * All persisted state carries a `schemaVersion` field. The current version is
 * `1`. A helper for migrating between versions lives in
 * {@link migrateWorkerState}.
 *
 * ## Append-only fire history
 *
 * {@link appendFireRecord} is intentionally the ONLY write path for fire
 * history. There is no `updateFireRecord` or `deleteFireRecord` on the
 * interface. This prevents a worker from rewriting its own record; the local
 * store is the ground-truth input for phase-19 reputation scoring.
 *
 * ## Naming mirrors CursorStore
 *
 * Method naming follows {@link CursorStore} so that operators who know one
 * interface can read the other without consulting docs:
 *
 * | CursorStore     | WorkerStateStore          |
 * |-----------------|---------------------------|
 * | `get`           | `getWorker`               |
 * | `set`           | `registerWorker`          |
 * | `getAll`        | `getAllWorkers`            |
 * | `ping`          | `ping`                    |
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/** Current schema version. Increment when making a breaking field change. */
export const WORKER_STATE_SCHEMA_VERSION = 1 as const;
export type WorkerStateSchemaVersion = typeof WORKER_STATE_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Core data types
// ---------------------------------------------------------------------------

/**
 * A single fire record appended each time a worker's window fires.
 * Immutable once written: the store only supports append, not update/delete.
 */
export interface WorkerFireRecord {
  /** ISO-8601 timestamp when the window started. */
  readonly windowStart: string;
  /** ISO-8601 timestamp when the window ended. */
  readonly windowEnd: string;
  /** ISO-8601 timestamp when the fire was recorded. */
  readonly firedAt: string;
  /** Optional opaque payload passed by the scheduler. */
  readonly payload?: unknown;
}

/**
 * A claim record written when a worker picks up a fire window to prevent
 * double-execution in multi-process deployments.
 */
export interface WorkerClaimRecord {
  /** Unique identifier for the fire window being claimed. */
  readonly windowId: string;
  /** Worker ID making the claim. */
  readonly workerId: string;
  /** ISO-8601 timestamp when the claim was made. */
  readonly claimedAt: string;
  /** ISO-8601 timestamp after which the claim is considered expired. */
  readonly expiresAt: string;
}

/**
 * Full persistent state for one worker.
 *
 * Field layout is the data contract. See {@link WORKER_STATE_SCHEMA_VERSION}.
 */
export interface WorkerState {
  readonly schemaVersion: WorkerStateSchemaVersion;
  /** Stable identifier for this worker (e.g. `"my-org/payment-processor"`). */
  readonly workerId: string;
  /** ISO-8601 timestamp when this worker was first registered. */
  readonly registeredAt: string;
  /** ISO-8601 timestamp of the most-recent update to this record. */
  readonly updatedAt: string;
  /**
   * ISO-8601 start timestamp of the last window that was fired.
   * `null` if the worker has never fired.
   */
  readonly lastFiredWindowStart: string | null;
  /**
   * ISO-8601 end timestamp of the last window that was fired.
   * `null` if the worker has never fired.
   */
  readonly lastFiredWindowEnd: string | null;
  /**
   * Append-only chronological list of fire records.
   * The store guarantees that records can only be appended, never modified
   * or removed.
   */
  readonly fireHistory: ReadonlyArray<WorkerFireRecord>;
  /**
   * Active claim records keyed by `windowId`. Only one claimer can hold a
   * claim per window at a time (enforced by the Postgres backend via a unique
   * constraint; other backends do a best-effort check).
   */
  readonly activeClaims: ReadonlyArray<WorkerClaimRecord>;
  /** Arbitrary operator-supplied metadata. Opaque to the store. */
  readonly metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Input types (mutable versions for store writes)
// ---------------------------------------------------------------------------

/** Fields required when registering a new worker. */
export interface RegisterWorkerInput {
  readonly workerId: string;
  readonly registeredAt?: string;
  readonly metadata?: Record<string, unknown>;
}

/** Options for {@link WorkerStateStore.appendFireRecord}. */
export interface AppendFireRecordInput {
  readonly workerId: string;
  readonly record: WorkerFireRecord;
}

/** Options for {@link WorkerStateStore.writeClaim}. */
export interface WriteClaimInput {
  readonly workerId: string;
  readonly claim: WorkerClaimRecord;
}

/** Options for {@link WorkerStateStore.releaseClaim}. */
export interface ReleaseClaimInput {
  readonly workerId: string;
  readonly windowId: string;
}

// ---------------------------------------------------------------------------
// The store interface
// ---------------------------------------------------------------------------

/**
 * Pluggable durable store for worker state.
 *
 * Subclasses must implement {@link getWorker}, {@link registerWorker},
 * {@link appendFireRecord}, {@link writeClaim}, and {@link releaseClaim}.
 * The remaining helpers ship with default implementations that compose those
 * five primitives, so a minimal implementation needs only those five.
 *
 * Backends that support more-efficient bulk or set-based I/O should override
 * {@link getAllWorkers} accordingly.
 */
export abstract class WorkerStateStore {
  // -------------------------------------------------------------------------
  // Primary primitives — must be implemented by each backend
  // -------------------------------------------------------------------------

  /**
   * Returns the current state for a worker, or `null` if not registered.
   */
  abstract getWorker(workerId: string): Promise<WorkerState | null>;

  /**
   * Registers a new worker, creating an entry with an empty fire history.
   * If the worker already exists the call is idempotent and the existing
   * record is returned unchanged.
   */
  abstract registerWorker(input: RegisterWorkerInput): Promise<WorkerState>;

  /**
   * Appends a fire record to a worker's history.
   * Updates `lastFiredWindowStart`, `lastFiredWindowEnd`, and `updatedAt`.
   *
   * Throws if the worker has not been registered.
   *
   * **This is the only write path for fire history.** There is no update or
   * delete: history is append-only to preserve phase-19 reputation inputs.
   */
  abstract appendFireRecord(input: AppendFireRecordInput): Promise<WorkerState>;

  /**
   * Writes or renews a claim for a fire window.
   * The claim is used to prevent double-execution in multi-process
   * deployments. Throws if the worker has not been registered.
   */
  abstract writeClaim(input: WriteClaimInput): Promise<WorkerState>;

  /**
   * Releases a claim, marking the window as no longer held by this worker.
   * A no-op if the claim does not exist.
   */
  abstract releaseClaim(input: ReleaseClaimInput): Promise<WorkerState>;

  // -------------------------------------------------------------------------
  // Enumeration helpers — default uses getWorker; backends may override
  // -------------------------------------------------------------------------

  /**
   * Returns all registered worker states.
   *
   * Default implementation throws because most stores cannot enumerate keys
   * without an explicit list. Backends backed by a database must override
   * this. Used by {@link migrateWorkerState}.
   */
  async getAllWorkers(): Promise<WorkerState[]> {
    throw new Error(
      `${this.constructor.name} does not support getAllWorkers(); worker enumeration is unavailable for this store.`,
    );
  }

  // -------------------------------------------------------------------------
  // Optional liveness probe
  // -------------------------------------------------------------------------

  /**
   * Optional liveness probe used by health-check integrations. Backends
   * connected to a network service should implement this to verify
   * connectivity.
   */
  ping?: () => Promise<void>;
}

/**
 * A structural alias for stores that cannot extend the abstract class
 * (e.g. third-party or duck-typed adapters).
 */
export type WorkerStateStoreLike = {
  getWorker(workerId: string): Promise<WorkerState | null>;
  registerWorker(input: RegisterWorkerInput): Promise<WorkerState>;
  appendFireRecord(input: AppendFireRecordInput): Promise<WorkerState>;
  writeClaim(input: WriteClaimInput): Promise<WorkerState>;
  releaseClaim(input: ReleaseClaimInput): Promise<WorkerState>;
  getAllWorkers?(): Promise<WorkerState[]>;
  ping?(): Promise<unknown>;
};
