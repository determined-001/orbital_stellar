/**
 * The copy-trade worker (issue #1070, "22.3 Copy-trade worker on the vault
 * pattern"). §C.1's reference trade-like worker: a whale trade is observed,
 * and the action is mirrored to subscribers - executed strictly through the
 * vault, so this module's authority never exceeds "call a constrained
 * function" (see `../vault/types.ts`).
 *
 * NOTE ON SCOPE: this issue is explicitly "the last thing built in the
 * entire backlog, deliberately" and depends on five other open issues - 22.2
 * (vault audit), 22.1 (the vault contract itself), 20.6 (event triggers),
 * 21.5 (regulatory framing), and 19.1 (verification). None of that
 * infrastructure exists in this repo. What follows is the decision logic a
 * real copy-trade worker would run - skip taxonomy, position-sizing bound,
 * revocation, latency budget - built against the `VaultClient` interface and
 * the existing `EventTrigger` type rather than a real vault or event system.
 * It is exercised in tests against a fake `VaultClient`; it has never been
 * run against a real one.
 *
 * "Reuse 20.6's event trigger for the observation side - do not add a second
 * matching path" (implementation note 3): `createCopyTradeTrigger` builds an
 * `EventTrigger` (from `../types.js`, already part of the worker-core type
 * model) rather than inventing a parallel "on trade observed" shape. Nothing
 * in this file adds a second way to describe "watch for an event."
 */

import type { EventTrigger } from "../types.js";
import type { VaultClient, VaultConfig, VaultExecutionResult } from "../vault/types.js";

/**
 * Builds the `EventTrigger` for watching a source account's trades on a
 * given asset - the observation side of a copy-trade worker, expressed with
 * the existing trigger type rather than a bespoke one. Not runtime-usable
 * until 20.6 implements event matching (`assertImplementedTrigger` still
 * throws for `"event"` triggers - see `../types.js`).
 */
export function createCopyTradeTrigger(sourceAccount: string, asset: string): EventTrigger {
  return {
    kind: "event",
    contractId: sourceAccount,
    eventTopic: `trade.executed.${asset}`,
  };
}

/**
 * A single observed trade from the source account being mirrored. In a real
 * deployment this is produced by 20.6's event matching against the trigger
 * `createCopyTradeTrigger` builds; here it is the input a caller (a test, or
 * eventually a real event-matched callback) constructs directly.
 */
export interface ObservedTrade {
  sourceAccount: string;
  asset: string;
  pool: string;
  side: "buy" | "sell";
  /** Raw (asset-native) size of the source trade. */
  sizeRaw: bigint;
  sourceTxHash: string;
  /** Ledger the source trade was observed at - the latency budget is measured from here. */
  observedAtLedgerSequence: number;
}

/**
 * Every reason a copy-trade decision can be skipped. Implementation note 1:
 * "Skips are a normal, expected outcome here and must be first-class in the
 * record - a skipped trade is the constraint working, not a failure." There
 * is deliberately no generic `"other"` or `"error"` catch-all - every skip
 * this module can produce has a specific, named reason.
 */
export type CopyTradeSkipReason =
  | "asset_not_allow_listed"
  | "pool_not_allow_listed"
  | "position_size_zero_after_bound"
  | "slippage_reverted"
  | "subscriber_revoked"
  | "latency_budget_exceeded";

export interface CopyTradeSkipRecord {
  workerId: string;
  observedTrade: ObservedTrade;
  reason: CopyTradeSkipReason;
  /** Extra context for the scorecard - e.g. the revert's `txHash`, the divergent bound. */
  detail?: unknown;
  recordedAtUnix: number;
}

export type CopyTradeOutcome =
  | {
      status: "executed";
      workerId: string;
      observedTrade: ObservedTrade;
      result: Extract<VaultExecutionResult, { status: "executed" }>;
    }
  | { status: "skipped"; skip: CopyTradeSkipRecord };

/**
 * Checked before every trade decision - "subscriber can revoke mid-flight
 * and the worker stops within one window." A real implementation reads this
 * from wherever subscription state lives (the vault contract itself, or an
 * off-chain subscription registry); this interface exists so `planCopyTrade`
 * does not need to know which.
 */
export interface RevocationCheck {
  isRevoked(subscriberAccount: string): Promise<boolean>;
}

export interface CopyTradeWorkerConfig {
  workerId: string;
  vaultClient: VaultClient;
  vaultId: string;
  revocation: RevocationCheck;
  /** Declared ledger budget: a source trade older than this (in ledgers) is skipped, not mirrored late. */
  latencyBudget: { maxLedgers: number };
  /** Called for every skip - the "recorded and notified" half of the acceptance criteria. */
  onSkip?: (record: CopyTradeSkipRecord) => void;
}

function skip(
  config: CopyTradeWorkerConfig,
  observedTrade: ObservedTrade,
  reason: CopyTradeSkipReason,
  recordedAtUnix: number,
  detail?: unknown,
): CopyTradeOutcome {
  const record: CopyTradeSkipRecord = {
    workerId: config.workerId,
    observedTrade,
    reason,
    detail,
    recordedAtUnix,
  };
  config.onSkip?.(record);
  return { status: "skipped", skip: record };
}

/**
 * Mirrors `observed` proportionally, at `mirrorRatioBps` of the source
 * trade's size, capped at the vault's configured `maxPositionSizeRaw`
 * (acceptance criterion: "Position sizing is bounded by vault configuration
 * the subscriber set"). Returns `0n` if the bound caps the size to nothing -
 * `planCopyTrade` treats that as a skip rather than submitting a zero-size
 * trade.
 */
export function computeMirroredSize(
  observed: ObservedTrade,
  vaultConfig: VaultConfig,
  mirrorRatioBps: number,
): bigint {
  const proportional = (observed.sizeRaw * BigInt(mirrorRatioBps)) / 10_000n;
  return proportional > vaultConfig.maxPositionSizeRaw
    ? vaultConfig.maxPositionSizeRaw
    : proportional;
}

/**
 * Decides what to do with one observed trade: mirror it through the vault,
 * or skip it with a named, recorded reason. Every branch either returns an
 * `"executed"` outcome or calls `skip(...)` - there is no path that returns
 * without producing an outcome, matching "never silently dropped."
 *
 * Order matters: latency budget and revocation are checked before the vault
 * is consulted at all (cheapest checks first, and a revoked subscriber's
 * vault should not be queried for a trade that will never happen); the
 * allow-list and position-size checks run against the vault's own
 * configuration, since that is the subscriber-set source of truth; the
 * slippage outcome is whatever the vault contract itself decided - this
 * module never second-guesses it.
 */
export async function planCopyTrade(
  observed: ObservedTrade,
  config: CopyTradeWorkerConfig,
  mirrorRatioBps: number,
  currentLedgerSequence: number,
  nowUnix: number,
): Promise<CopyTradeOutcome> {
  const elapsedLedgers = currentLedgerSequence - observed.observedAtLedgerSequence;
  if (elapsedLedgers > config.latencyBudget.maxLedgers) {
    return skip(config, observed, "latency_budget_exceeded", nowUnix, {
      elapsedLedgers,
      maxLedgers: config.latencyBudget.maxLedgers,
    });
  }

  const vaultConfig = await config.vaultClient.getConfig(config.vaultId);

  const revoked = await config.revocation.isRevoked(vaultConfig.subscriberAccount);
  if (revoked) {
    return skip(config, observed, "subscriber_revoked", nowUnix);
  }

  if (!vaultConfig.allowListedAssets.includes(observed.asset)) {
    return skip(config, observed, "asset_not_allow_listed", nowUnix, { asset: observed.asset });
  }
  if (!vaultConfig.allowListedPools.includes(observed.pool)) {
    return skip(config, observed, "pool_not_allow_listed", nowUnix, { pool: observed.pool });
  }

  const sizeRaw = computeMirroredSize(observed, vaultConfig, mirrorRatioBps);
  if (sizeRaw <= 0n) {
    return skip(config, observed, "position_size_zero_after_bound", nowUnix, {
      maxPositionSizeRaw: vaultConfig.maxPositionSizeRaw.toString(),
    });
  }

  const result = await config.vaultClient.execute({
    vaultId: config.vaultId,
    asset: observed.asset,
    pool: observed.pool,
    side: observed.side,
    sizeRaw,
    maxSlippageBps: vaultConfig.slippageBoundBps,
  });

  if (result.status === "reverted") {
    // Acceptance criterion: "Slippage violations revert on chain and are
    // recorded as skips, not misses" - a revert is not an error path here,
    // it is the vault's own last line of defence doing its job.
    return skip(config, observed, "slippage_reverted", nowUnix, { txHash: result.txHash });
  }

  return { status: "executed", workerId: config.workerId, observedTrade: observed, result };
}
