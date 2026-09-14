/**
 * Pluggable durable store for worker fire/miss verdicts (issue #1050,
 * "19.2 Verdict store and wire schema").
 *
 * The verdict JSON is a wire contract under `STABILITY.md`: it is what an
 * operator disputes, what a subscriber audits, and what a backstop claim is
 * assessed against in W3. Breaking it requires a major.
 *
 * ## Relationship to `packages/abi-registry/src/verdictStore.ts`
 *
 * That module's `VerdictStore`/`VerdictRecord` score whether a contract's
 * on-chain ABI still matches a *submitted spec* (`"verified" | "mismatch" |
 * "unverifiable"`, keyed by `contractId`) - compliance/audit territory
 * entirely unrelated to this one. This store scores whether *a specific
 * worker honored a specific obligation window* (`"fired" | "missed" |
 * "late" | "not-due"`, keyed by `workerId` + `windowId`), produced by
 * `WorkerVerificationEngine` (#1049). The two happen to share the word
 * "verdict" and nothing else - same domain overlap already noted in
 * `workerFireVerdict.ts`. This is a deliberate sibling, not an extension:
 * merging them would force one status vocabulary and one key shape onto two
 * unrelated questions.
 *
 * ## Relationship to `backstop/slo.ts`'s `WorkerVerdictStore` port
 *
 * `evaluateBackstopSlo` (21.x, already shipped) already declares a narrower
 * structural port - also named `WorkerVerdictStore`, forcing this module's
 * export to be named `WorkerFireVerdictStore` instead - with the *same*
 * status vocabulary (`WorkerWindowStatus`) but different field names
 * (`operatorId`/`ledgerStart`/`ledgerEnd` vs this module's
 * `operator`/`conditionLedger`/`deadlineLedger`) and no immutability,
 * correction, or indexed-query surface. That port is what
 * `evaluateBackstopSlo` was actually built and tested against, so this
 * module does not replace it - `backstopVerdictStoreAdapter.ts` adapts a
 * `WorkerFireVerdictStore` to satisfy it, which is how 21.x's backstop
 * evaluator gets real verdicts once this store has data.
 *
 * ## Immutability
 *
 * A verdict record is never updated or deleted once written. A correction -
 * the engine version changed, a backfill filled in a gap, a bug is fixed -
 * is written as a *new* record whose `supersedes` names the record it
 * corrects and whose `correctionReason` says why. `getLatestForWindow`
 * follows the supersession chain to the newest record; `getHistoryForWindow`
 * returns every record including superseded ones, oldest first. This is
 * what makes a stored verdict explainable as "the engine changed" rather
 * than as tampering (#1049's determinism plus this store's immutability is
 * what makes a verdict actually disputable).
 *
 * ## Indexing
 *
 * `queryByWorker`, `queryByOperator`, and `queryByLedgerRange` are the three
 * query shapes W3's scorecards need. Retrofitting indexes onto a live
 * verdict table is real, avoidable pain - see `migrations/002_worker_verdicts.sql`.
 */
import type { WorkerFireVerdict } from "./workerFireVerdict.js";

/** Current schema version. Increment when making a breaking field change. */
export const WORKER_VERDICT_SCHEMA_VERSION = 1 as const;
export type WorkerVerdictSchemaVersion = typeof WORKER_VERDICT_SCHEMA_VERSION;

/**
 * One persisted verdict. Extends {@link WorkerFireVerdict} (the engine's pure
 * output) with everything the store adds: identity across corrections,
 * provenance (who produced it and with what code), and the operator the
 * worker belongs to (needed for {@link WorkerFireVerdictStore.queryByOperator}
 * without a join back to the worker registry).
 */
export type WorkerVerdictRecord = WorkerFireVerdict & {
  readonly schemaVersion: WorkerVerdictSchemaVersion;
  /**
   * Unique per record, not per window - a window with two corrections has
   * three records sharing one `windowId` but three distinct `recordId`s.
   */
  readonly recordId: string;
  /** Public key of the worker's operator (`WorkerDefinition.operator`). */
  readonly operator: string;
  /**
   * Identifies the exact `WorkerVerificationEngine` build that produced this
   * verdict - typically the package version, e.g. `"@orbital-stellar/worker-core@0.4.2"`.
   * A verdict that changes across a re-run is explainable by diffing this
   * field, which is the entire point of stamping it.
   */
  readonly engineVersion: string;
  /** ISO-8601 timestamp this record was written. */
  readonly recordedAt: string;
  /** `recordId` of the record this one corrects, if any. */
  readonly supersedes?: string;
  /** Required whenever `supersedes` is set - why the correction was made. */
  readonly correctionReason?: string;
};

/** Fields the caller supplies; the store fills in `schemaVersion` and `recordedAt`. */
export type RecordVerdictInput = Omit<WorkerVerdictRecord, "schemaVersion" | "recordedAt"> & {
  readonly recordedAt?: string;
};

/** Options shared by the three query methods. */
export interface WorkerVerdictQueryOptions {
  readonly fromLedger?: number;
  readonly toLedger?: number;
  /** Excludes superseded records unless explicitly requested. Defaults to `true`. */
  readonly latestOnly?: boolean;
}

/**
 * Thrown by {@link WorkerFireVerdictStore.record} when a `recordId` that already
 * exists is written again - the concrete mechanism enforcing immutability.
 */
export class DuplicateVerdictRecordError extends Error {
  readonly recordId: string;
  constructor(recordId: string) {
    super(
      `WorkerFireVerdictStore: a record with recordId "${recordId}" already exists. ` +
        "Verdicts are immutable - write a new record with `supersedes` set instead.",
    );
    this.name = "DuplicateVerdictRecordError";
    this.recordId = recordId;
  }
}

/**
 * Thrown by {@link WorkerFireVerdictStore.record} when `supersedes` is set
 * without a `correctionReason` - a correction with no stated reason is not
 * a correction an operator can dispute or a maintainer can audit.
 */
export class MissingCorrectionReasonError extends Error {
  constructor(recordId: string) {
    super(
      `WorkerFireVerdictStore: record "${recordId}" sets supersedes without a correctionReason.`,
    );
    this.name = "MissingCorrectionReasonError";
  }
}

export abstract class WorkerFireVerdictStore {
  /**
   * Writes a new verdict record. Throws {@link DuplicateVerdictRecordError}
   * if `recordId` already exists, and {@link MissingCorrectionReasonError}
   * if `supersedes` is set without a `correctionReason` - both checked
   * before any backend-specific write, so every implementation enforces
   * them identically regardless of what the underlying store would allow.
   */
  async record(input: RecordVerdictInput): Promise<WorkerVerdictRecord> {
    if (input.supersedes !== undefined && !input.correctionReason) {
      throw new MissingCorrectionReasonError(input.recordId);
    }
    const record: WorkerVerdictRecord = {
      ...input,
      schemaVersion: WORKER_VERDICT_SCHEMA_VERSION,
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    };
    await this._write(record);
    return record;
  }

  /** Backend-specific write. Must throw {@link DuplicateVerdictRecordError} for a repeated `recordId`. */
  protected abstract _write(record: WorkerVerdictRecord): Promise<void>;

  /**
   * The newest, non-superseded record for `windowId`, or `null` if none
   * exists. Follows the supersession chain: if the newest-written record
   * for the window has been superseded by a later correction, that
   * correction is returned instead.
   */
  abstract getLatestForWindow(windowId: string): Promise<WorkerVerdictRecord | null>;

  /** Every record for `windowId`, including superseded ones, oldest first. */
  abstract getHistoryForWindow(windowId: string): Promise<WorkerVerdictRecord[]>;

  /** Verdicts for one worker, optionally bounded by ledger range. Indexed on `workerId`. */
  abstract queryByWorker(
    workerId: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]>;

  /** Verdicts across every worker belonging to one operator. Indexed on `operator`. */
  abstract queryByOperator(
    operator: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]>;

  /** Verdicts across every worker whose window overlaps `[fromLedger, toLedger]`. Indexed on ledger range. */
  abstract queryByLedgerRange(
    fromLedger: number,
    toLedger: number,
    options?: Omit<WorkerVerdictQueryOptions, "fromLedger" | "toLedger">,
  ): Promise<WorkerVerdictRecord[]>;

  /** Optional liveness probe used by health-check integrations. */
  ping?: () => Promise<void>;
}
