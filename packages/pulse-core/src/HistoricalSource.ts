/**
 * Beyond-retention historical replay (issue #920 / "12.6").
 *
 * **Not wired into `EventEngine` or `CursorStore`.** This is a standalone
 * interface only - see `docs/design/long-range-replay.md` for why: the
 * transport-routing design this is supposed to plug into ("6.12") and the
 * unified cursor format it's supposed to share ("6.14") don't exist yet in
 * this repo. Wiring this in now would mean guessing at both, which is
 * exactly what the parent issue warns against. When "6.12"/"6.14" land,
 * `HistoricalSource` should become one more transport in that routing layer,
 * not a parallel path alongside it.
 *
 * Cursors here are opaque strings, same as everywhere else in this codebase
 * (`CursorStore`'s own doc comment: "Cursor values are source-local opaque
 * strings"). This is deliberately *not* a new cursor format - when "6.14"'s
 * unified cursor lands, a `HistoricalSource` cursor should be representable
 * within it, not a third shape alongside it.
 */

import type { SorobanEvent } from "./SorobanSubscriber.js";

/** One bounded ledger range to replay events from. */
export type HistoricalReplayRange = {
  /** Inclusive. */
  startLedger: number;
  /** Exclusive, matching `EventEngine.replayContracts()`'s existing `endLedger` semantics. */
  endLedger: number;
  /** Optional contract-id filter; omit to replay every contract's events in range. */
  contractIds?: string[];
};

/**
 * A source of Soroban contract events for ledger ranges that predate the
 * configured RPC's retention window. Implementations must yield events in
 * ascending ledger order (matching `EventEngine.replayContracts()`'s existing
 * ordering guarantee) so a caller composing this with RPC-based replay sees
 * one continuous, ordered stream regardless of which source served which
 * part of the range.
 */
export interface HistoricalSource {
  /** A short, stable name identifying this source - surfaced in {@link RetentionBoundaryError} and logs. Not used for routing logic. */
  readonly name: string;

  /**
   * Whether this source can serve `range` at all (e.g. the export bucket
   * actually has data covering it). Does not guarantee `replay` will
   * succeed - only that the range is in scope for this source. Callers
   * should treat `false` as "try a different source or fail with
   * `RetentionBoundaryError`", not as evidence the range has no events.
   */
  canServe(range: HistoricalReplayRange): Promise<boolean>;

  /**
   * Yields every event in `range`, in ascending ledger order. Implementations
   * should throw rather than yield partial results on an unrecoverable
   * fetch/parse failure - a caller mid-replay cannot distinguish "no more
   * events" from "the source silently stopped early" unless failures throw.
   */
  replay(range: HistoricalReplayRange): AsyncIterable<SorobanEvent>;
}

/**
 * Thrown when a requested replay range falls outside both the live RPC's
 * retention window and whatever `HistoricalSource` is configured (or when
 * none is configured at all) - names the boundary and the source so the
 * failure is actionable instead of an opaque RPC error, per this issue's
 * acceptance criteria.
 */
export class RetentionBoundaryError extends Error {
  readonly requestedLedger: number;
  readonly retentionBoundaryLedger: number;
  readonly configuredSource?: string;

  constructor(params: {
    requestedLedger: number;
    retentionBoundaryLedger: number;
    configuredSource?: string;
  }) {
    const sourceNote = params.configuredSource
      ? `configured historical source "${params.configuredSource}" was asked to serve it and could not`
      : "no historical source is configured to serve ranges before that boundary";
    super(
      `[pulse-core] Requested ledger ${params.requestedLedger} predates the RPC's retention ` +
        `boundary (${params.retentionBoundaryLedger}); ${sourceNote}.`,
    );
    this.name = "RetentionBoundaryError";
    this.requestedLedger = params.requestedLedger;
    this.retentionBoundaryLedger = params.retentionBoundaryLedger;
    if (params.configuredSource !== undefined) this.configuredSource = params.configuredSource;
  }
}
