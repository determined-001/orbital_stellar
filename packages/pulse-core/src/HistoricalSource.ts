/**
 * Long-range replay beyond Soroban RPC's retention window (issue #920,
 * "12.6"), per `docs/design/long-range-replay.md`.
 *
 * Soroban RPC retains roughly seven days of history (verified live against
 * `https://soroban-testnet.stellar.org`, see the design note §1). A cursor
 * or `startLedger` older than that fails `getEvents` with a JSON-RPC
 * `-32600` whose message names the currently-retained range - the only
 * signal the RPC gives today, and what this module's retention-boundary
 * parsing is built on.
 */
import type { SorobanRpcLike } from "./SorobanSubscriber.js";
import { SorobanRpcError, isSorobanRpcError } from "./errors.js";

/**
 * A source of historical Soroban contract events reaching further back than
 * a primary RPC's retention window. Deliberately the *same shape* as
 * {@link SorobanRpcLike} - not a bespoke type - so it plugs into the exact
 * decode path `SorobanSubscriber` already runs, producing the same
 * `NormalizedEvent` output regardless of which source answered.
 *
 * One reference adapter ships here, {@link RpcHistoricalSource}, wrapping
 * any second `SorobanRpcLike`-compatible client (concretely, a
 * backfill-configured RPC endpoint - see the design note §2 for why that
 * was chosen over a Composable Data Platform / Galexie export). The
 * interface itself does not know or care that the adapter happens to be an
 * RPC client; a Galexie-backed adapter would implement the same shape
 * differently.
 */
export interface HistoricalSource extends SorobanRpcLike {
  /**
   * True if this source's own retention is expected to cover `ledger`.
   * A cheap bound check, not required to be exact or to make a network
   * call - it only gates whether `EventEngine` attempts a fallback request
   * at all, not whether that request ultimately succeeds.
   */
  covers(ledger: number): Promise<boolean> | boolean;
}

/**
 * Wraps a second `SorobanRpcLike` client (a backfill-configured RPC
 * endpoint) as a {@link HistoricalSource}. `earliestLedger`, if known, backs
 * {@link covers}; when omitted every ledger is reported as potentially
 * covered and the underlying RPC's own response is the real answer.
 */
export class RpcHistoricalSource implements HistoricalSource {
  constructor(
    private readonly rpc: SorobanRpcLike,
    private readonly earliestLedger?: number,
  ) {}

  covers(ledger: number): boolean {
    return this.earliestLedger === undefined || ledger >= this.earliestLedger;
  }

  getEvents(
    ...args: Parameters<SorobanRpcLike["getEvents"]>
  ): ReturnType<SorobanRpcLike["getEvents"]> {
    return this.rpc.getEvents(...args);
  }

  async getLatestLedger(
    ...args: Parameters<NonNullable<SorobanRpcLike["getLatestLedger"]>>
  ): ReturnType<NonNullable<SorobanRpcLike["getLatestLedger"]>> {
    if (!this.rpc.getLatestLedger) {
      throw new TypeError("RpcHistoricalSource: underlying rpc has no getLatestLedger");
    }
    return this.rpc.getLatestLedger(...args);
  }
}

/**
 * Thrown when a requested ledger range cannot be served by either the
 * primary RPC or a configured {@link HistoricalSource} (or none was
 * configured at all). Names the parsed retention boundary and whether a
 * historical source was in play, per the issue's own acceptance criterion -
 * "out-of-retention errors name the retention boundary and the configured
 * historical source."
 */
export class OutOfRetentionError extends Error {
  /** The oldest ledger the primary RPC reported as retained, if its error message could be parsed. `undefined` if not - see `docs/design/long-range-replay.md` §6 on this parsing's inherent fragility. */
  readonly retentionBoundaryLedger: number | undefined;
  readonly requestedLedger: number;
  readonly historicalSourceConfigured: boolean;

  constructor(
    requestedLedger: number,
    retentionBoundaryLedger: number | undefined,
    historicalSourceConfigured: boolean,
  ) {
    const boundary =
      retentionBoundaryLedger !== undefined
        ? `the primary RPC's retention boundary (ledger ${retentionBoundaryLedger})`
        : "the primary RPC's retention boundary (could not be parsed from its error)";
    const source = historicalSourceConfigured
      ? "the configured historical source could not serve it either"
      : "no historical source is configured";
    super(`Requested ledger ${requestedLedger} is older than ${boundary}, and ${source}.`);
    this.name = "OutOfRetentionError";
    this.retentionBoundaryLedger = retentionBoundaryLedger;
    this.requestedLedger = requestedLedger;
    this.historicalSourceConfigured = historicalSourceConfigured;
  }
}

/**
 * Matches Soroban RPC's actual out-of-retention error text (live-verified,
 * see the design note §1): `"startLedger must be within the ledger range:
 * <oldest> - <newest>"`. Not a documented, stable API contract - if a
 * future RPC version changes the wording this simply stops matching, which
 * degrades to `retentionBoundaryLedger: undefined` in {@link OutOfRetentionError}
 * rather than parsing something wrong.
 */
const RETENTION_RANGE_PATTERN = /ledger range:\s*(\d+)\s*-\s*(\d+)/i;

/** True if `error` looks like Soroban RPC's out-of-retention response. */
export function isOutOfRetentionError(error: unknown): error is SorobanRpcError {
  return isSorobanRpcError(error) && RETENTION_RANGE_PATTERN.test(error.message);
}

/** Extracts the oldest retained ledger from an out-of-retention error's message, or `undefined` if the text didn't match the expected shape. */
export function parseRetentionBoundary(error: SorobanRpcError): number | undefined {
  const match = RETENTION_RANGE_PATTERN.exec(error.message);
  if (!match) return undefined;
  const oldest = Number(match[1]);
  return Number.isFinite(oldest) ? oldest : undefined;
}

/**
 * Wraps `primary` so a bounded replay starting before its retention window
 * transparently continues against `historicalSource` instead of failing -
 * the fallback described in the design note §4. Once a call falls back, the
 * wrapper stays on `historicalSource` for the rest of this wrapper's
 * lifetime (one bounded `replayContracts` run): events are chronological
 * and a run's `startLedger` is fixed, so a call that needed history once
 * needs it for every subsequent page of the same run too.
 *
 * **Scoping, stated plainly:** this does not switch back to `primary` if a
 * run's range straddles the retention boundary and later pages would
 * actually be servable by it again - the historical source is expected to
 * carry through `endLedger` once it has taken over (a deep-retention
 * backfill RPC typically retains recent ledgers too, not just the old
 * window). Splitting one run across both sources mid-flight is real added
 * complexity for a case the issue's own acceptance criterion does not
 * require; a caller needing that can run two bounded replays instead.
 *
 * Always safe to call, including with `historicalSource: undefined` - an
 * out-of-retention error is still translated into an informative
 * `OutOfRetentionError` naming the parsed boundary and that no historical
 * source was configured, per the issue's acceptance criterion. Only the
 * *fallback attempt itself* is skipped when none is configured.
 */
export function withHistoricalFallback(
  primary: SorobanRpcLike,
  historicalSource: HistoricalSource | undefined,
  startLedger: number,
): SorobanRpcLike {
  let usingHistorical = false;

  return {
    async getEvents(...args: Parameters<SorobanRpcLike["getEvents"]>) {
      if (usingHistorical && historicalSource) {
        return historicalSource.getEvents(...args);
      }
      try {
        return await primary.getEvents(...args);
      } catch (err) {
        if (!isOutOfRetentionError(err)) throw err;

        const boundary = parseRetentionBoundary(err);
        if (!historicalSource || !(await historicalSource.covers(startLedger))) {
          throw new OutOfRetentionError(startLedger, boundary, historicalSource !== undefined);
        }

        usingHistorical = true;
        try {
          return await historicalSource.getEvents(...args);
        } catch {
          throw new OutOfRetentionError(startLedger, boundary, true);
        }
      }
    },
    getLatestLedger: primary.getLatestLedger
      ? (...args: Parameters<NonNullable<SorobanRpcLike["getLatestLedger"]>>) =>
          primary.getLatestLedger!(...args)
      : undefined,
  };
}
