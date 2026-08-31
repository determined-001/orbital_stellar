import type { StellarAmount } from "./amount.js";
import type { AccountAddress, MuxedAddress, ContractAddress } from "./address.js";
import type { ClaimPredicate } from "./claimPredicate.js";

export { SorobanRpcClient, CAP_67_EVENT_TOPICS } from "./SorobanRpcClient.js";
export type {
  JsonRpcFailure,
  JsonRpcResponse,
  JsonRpcSuccess,
  PollUnifiedEventsOptions,
  SorobanEventFilter,
  SorobanEventXdrFormat,
  SorobanGetEventsParams,
  SorobanGetEventsResult,
  SorobanLatestLedgerResult,
  SorobanNetworkInfo,
  SorobanRpcCallOptions,
  SorobanRpcClientOptions,
  SorobanRpcEvent,
} from "./SorobanRpcClient.js";
export { EventEngine } from "./EventEngine.js";
export { SorobanSubscriber } from "./SorobanSubscriber.js";
export type {
  SorobanSubscriberOptions,
  ReconnectingPayload,
  SorobanRpc,
  SorobanEvent,
  CursorStore as SorobanCursorStore,
} from "./SorobanSubscriber.js";

export { validateContractFilters } from "./contractFilters.js";
export { Watcher } from "./Watcher.js";
export { toStellarAmount, toBigInt } from "./amount.js";
export type { StellarAmount } from "./amount.js";
export type { AccountAddress, MuxedAddress, ContractAddress } from "./address.js";
export {
  isAccountAddress,
  isMuxedAddress,
  isContractAddress,
  isStellarAddress,
  toAccountAddress,
  toMuxedAddress,
  toContractAddress,
} from "./address.js";
export {
  EngineAlreadyStartedError,
  HorizonStreamError,
  InvalidIngestionModeError,
} from "./errors.js";
export { StrKey } from "@stellar/stellar-sdk";
// Re-exported so @orbital-stellar/anchor-sdk can validate SEP-10 challenges
// without taking its own direct dependency on @stellar/stellar-sdk.
export { WebAuth } from "@stellar/stellar-sdk";
export { CursorStore } from "./CursorStore.js";
export type { CursorStoreLike } from "./CursorStore.js";
import type { CursorStoreLike } from "./CursorStore.js";
export { MemoryCursorStore } from "./MemoryCursorStore.js";
export { FileCursorStore } from "./FileCursorStore.js";
export { PostgresCursorStore } from "./PostgresCursorStore.js";
export type { PgLike } from "./PostgresCursorStore.js";
export { RedisCursorStore } from "./RedisCursorStore.js";
export { S3CursorStore } from "./S3CursorStore.js";
export { cacheCursorStore } from "./cacheCursorStore.js";
export { coalesceCursorStore, CoalescingStore } from "./coalesceCursorStore.js";
export type { CoalescingStoreOptions } from "./coalesceCursorStore.js";
export { migrateCursors } from "./migrateCursors.js";
export type { MigrateCursorsResult } from "./migrateCursors.js";
export type { IRegistryStore } from "./IRegistryStore.js";
export { InMemoryRegistryStore } from "./IRegistryStore.js";
export { FileRegistryStore } from "./FileRegistryStore.js";

export {
  assertRestrictedSecretNetwork,
  isCiEnvironment,
  redactSecret,
  MainnetSecretInRestrictedPathError,
} from "./secretPolicy.js";
export type { SecretPolicyContext, AssertRestrictedSecretOptions } from "./secretPolicy.js";
export { isEventType } from "./eventTypeGuard.js";
export { deriveDedupeKey, DedupeWindow, InvalidDedupeWindowCapacityError } from "./dedupe.js";
export type { DedupeEventRef } from "./dedupe.js";
export * from "./claimPredicate.js";
export * from "./raw-horizon.js";
export * from "./raw-soroban.js";
import type { RawSorobanEvent } from "./raw-soroban.js";

import {
  RawHorizonPayment,
  RawHorizonSetOptions,
  RawHorizonCreateAccount,
  RawHorizonManageSellOffer,
  RawHorizonManageBuyOffer,
  RawHorizonBumpSequence,
  RawHorizonManageData,
  RawHorizonChangeTrust,
  RawHorizonAccountMerge,
  RawHorizonCreateClaimableBalance,
  RawHorizonClaimClaimableBalance,
  RawHorizonLiquidityPoolDeposit,
  RawHorizonLiquidityPoolWithdraw,
  RawHorizonAllowTrust,
  RawHorizonSetTrustLineFlags,
} from "./raw-horizon.js";

/** The Stellar network to connect to. */
export type Network = "mainnet" | "testnet";

export type SourceStatus = {
  running: boolean;
  lastEventAt: string | null;
  reconnectAttempt: number;
  cursor?: string;
};

export type EngineStatus = {
  running: boolean;
  watcherCount: number;
  contractWatcherCount?: number;
  lastEventAt: string | null;
  reconnectAttempt: number;
  pausedSources?: ("horizon" | "soroban")[];
  /** The configured value of `CoreConfig.ingestion` (default `"horizon"`). Routing/auto-resolution behavior itself is a separate concern - see `CoreConfig.ingestion`'s doc. */
  ingestion: IngestionMode;
  sources: {
    horizon: SourceStatus;
    soroban: SourceStatus;
    /** The CAP-67 unified event poller (see `SorobanConfig.unifiedEvents`). */
    unified: SourceStatus;
  };
  /**
   * Present only when the engine was constructed with an array of network
   * sources (`CoreConfig.network` as `NetworkSourceConfig[]`); per-network
   * breakdown of `sources`. `sources` above is an aggregate across all
   * configured networks for consumers that don't need the per-network detail.
   */
  networks?: Partial<
    Record<Network, { horizon: SourceStatus; soroban: SourceStatus; unified: SourceStatus }>
  >;
};

/** Passphrase strings for each supported Stellar network. */
export const NETWORK_PASSPHRASES = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
} as const satisfies Record<Network, string>;

/** Event types for payment-related events (received, sent, or self-payment). */
export type PaymentEventType = "payment.received" | "payment.sent" | "payment.self";
/** Event type for account options changes. */
export type AccountOptionsEventType = "account.options_changed";
export type LiquidityPoolEventType = "lp.deposited" | "lp.withdrawn";
export type TrustAuthEventType = "trustline.authorized" | "trustline.deauthorized";
/**
 * Event type for a CAP-67 unified-stream `clawback` event. Has no
 * Horizon-derived equivalent in this package's current taxonomy, unlike
 * `mint`/`burn`, which map onto the existing `payment.received`/`payment.sent`
 * shape.
 */
export type AssetClawbackEventType = "asset.clawback";
/**
 * Event type for a CAP-67 unified-stream `fee` event. New in CAP-67 - no
 * Horizon-derived equivalent exists in this package's current taxonomy
 * (fees were previously only derivable implicitly from transaction
 * metadata, not modeled as a discrete event).
 */
export type FeeIncurredEventType = "fee.incurred";
/** Event type for account creation. */
export type AccountEventType = "account.created";
export type ClaimableCreatedEventType = "claimable.created";
export type ClaimableClaimedEventType = "claimable.claimed";
/** Event types for trustline lifecycle events (added, removed, or limit updated). */
export type TrustlineEventType = "trustline.added" | "trustline.removed" | "trustline.updated";
/** Event type for account merges (one account merged into another). */
export type AccountMergeEventType = "account.merged";
/** Notification types emitted by the EventEngine during reconnection. */
export type WatcherNotificationType =
  | "engine.reconnecting"
  | "engine.reconnected"
  | "engine.rate_limited"
  | "engine.stopped"
  | "engine.cursor_store_unhealthy"
  | "engine.cursor_expired"
  | "engine.backpressure";

export type OfferEventType = "offer.created" | "offer.updated" | "offer.deleted";
export type BumpSequenceEventType = "account.bump_sequence";
export type DataEventType = "data.set" | "data.cleared";

/**
 * Represents a signer in Stellar account options.
 */
export type SetOptionsSigner = {
  /** The public key of the signer. */
  key: AccountAddress;
  /** The weight of the signer for multi-signature transactions. */
  weight: number;
};

/**
 * Changes to an account's options detected by the EventEngine.
 */
export type AccountOptionsChanges = {
  /** Signer that was added to the account. */
  signer_added?: SetOptionsSigner;
  /** Signer that was removed from the account. */
  signer_removed?: SetOptionsSigner;
  /** Updated threshold values for the account. */
  thresholds?: {
    /** Low threshold for the account. */
    low_threshold?: number;
    /** Medium threshold for the account. */
    med_threshold?: number;
    /** High threshold for the account. */
    high_threshold?: number;
    /** Weight of the master key. */
    master_key_weight?: number;
  };
  /** Updated home domain of the account. */
  home_domain?: string;
};

/**
 * Transaction-identity fields carried by every classic (Horizon-sourced)
 * normalized event, mirroring the `ledger`/`txHash` the Soroban half of the
 * taxonomy already carries. All three are optional because a transport that
 * cannot supply them must still produce a valid event - `STABILITY.md`'s
 * semver pledge binds from `1.0.0`, and optional fields stay additive.
 *
 * Populated from the Horizon operation record (`transaction_hash`) and from
 * the transaction joined onto it via `join=transactions` (`ledger`, `memo`).
 */
export type ClassicEventIdentity = {
  /**
   * Hash of the transaction this event came from. The stable transaction
   * identity a consumer needs to deduplicate work already done - pair it with
   * an operation index and {@link deriveDedupeKey}.
   */
  txHash?: string;
  /** Ledger sequence the transaction was included in, for audit and attestation without a second Horizon round-trip. */
  ledger?: number;
  /**
   * The originating transaction's memo, when the transaction carried one.
   * Set by the CAP-67 unified transport (from a transfer event's map-based
   * data form) and, for Horizon-sourced events, from the joined transaction.
   * Absent when `memo_type` is `"none"`.
   */
  memo?: string;
};

/**
 * A normalized payment event from the Stellar network.
 */
export type PaymentEvent = {
  /** The type of payment event (received or sent). */
  type: PaymentEventType;
  /** The destination address of the payment. */
  to: AccountAddress | MuxedAddress;
  /** The source address of the payment. */
  from: AccountAddress | MuxedAddress;
  /** The amount of the payment as a string. */
  amount: StellarAmount;
  /** The asset being transferred (e.g., "XLM" or "ASSET:issuer"). */
  asset: string;
  /** ISO 8601 timestamp of the payment. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Horizon API. */
  raw?: RawHorizonPayment;
} & ClassicEventIdentity;

/**
 * A normalized account options change event from the Stellar network.
 */
export type AccountOptionsEvent = {
  /** The type of account options event. */
  type: AccountOptionsEventType;
  /** The Stellar account whose options changed. */
  source: AccountAddress;
  /** The specific changes made to the account options. */
  changes: AccountOptionsChanges;
  /** ISO 8601 timestamp of the options change. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Horizon API. */
  raw?: RawHorizonSetOptions;
} & ClassicEventIdentity;

/** Rational (numerator/denominator) form of an offer's price, as returned by Horizon. */
export type PriceR = { n: number; d: number };

export type OfferEvent = {
  type: OfferEventType;
  offer_id: string;
  source: AccountAddress;
  buying_asset: string;
  selling_asset: string;
  amount: StellarAmount;
  price: string;
  /** Rational form of `price` (exact, avoids floating-point rounding). */
  price_r: PriceR;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonManageSellOffer | RawHorizonManageBuyOffer;
} & ClassicEventIdentity;

export type BumpSequenceEvent = {
  type: BumpSequenceEventType;
  source: AccountAddress;
  bump_to: string;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonBumpSequence;
} & ClassicEventIdentity;

export type ClaimableBalanceClaimant = {
  destination: AccountAddress;
  predicate: ClaimPredicate;
};

export type ClaimableCreatedEvent = {
  type: ClaimableCreatedEventType;
  sponsor: AccountAddress;
  balanceId: string;
  claimants: ClaimableBalanceClaimant[];
  asset: string;
  amount: StellarAmount;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonCreateClaimableBalance;
} & ClassicEventIdentity;

export type ClaimableClaimedEvent = {
  type: ClaimableClaimedEventType;
  claimant: AccountAddress;
  balanceId: string;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonClaimClaimableBalance;
} & ClassicEventIdentity;

export type DataEvent = {
  type: DataEventType;
  source: AccountAddress;
  name: string;
  /** The raw base64-encoded value returned by Horizon, or null when cleared. */
  value: string | null;
  /** The decoded bytes of `value` as a Uint8Array, or null when `value` is null or invalid base64. */
  decoded: Uint8Array | null;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonManageData;
} & ClassicEventIdentity;

export type LiquidityPoolReserve = {
  asset: string;
  amount: StellarAmount;
};

export type LiquidityPoolDepositEvent = {
  type: "lp.deposited";
  source: AccountAddress;
  pool_id: string;
  reserves_deposited: LiquidityPoolReserve[];
  shares_received: string;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonLiquidityPoolDeposit;
} & ClassicEventIdentity;

export type LiquidityPoolWithdrawEvent = {
  type: "lp.withdrawn";
  source: AccountAddress;
  pool_id: string;
  reserves_received: LiquidityPoolReserve[];
  shares_redeemed: string;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  raw?: RawHorizonLiquidityPoolWithdraw;
} & ClassicEventIdentity;

export type TrustAuthEvent = {
  type: TrustAuthEventType;
  trustor: AccountAddress;
  issuer: AccountAddress;
  asset: string;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The originating operation type: "allow_trust" or "set_trust_line_flags" from Horizon, or "set_authorized" from the CAP-67 unified stream. */
  operation: string;
  raw?: RawHorizonAllowTrust | RawHorizonSetTrustLineFlags;
} & ClassicEventIdentity;

/**
 * A normalized account creation event from the Stellar network.
 */
export type AccountCreatedEvent = {
  /** The type of account creation event. */
  type: AccountEventType;
  /** The Stellar account that funded the new account. */
  funder: AccountAddress;
  /** The newly created Stellar account address. */
  account: AccountAddress;
  /** The starting balance transferred to the new account. */
  starting_balance: string;
  /** ISO 8601 timestamp of the account creation. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Horizon API. */
  raw?: RawHorizonCreateAccount;
} & ClassicEventIdentity;

/**
 * A normalized trustline lifecycle event from the Stellar network.
 */
export type TrustlineEvent = {
  /** The type of trustline event (added, removed, or updated). */
  type: TrustlineEventType;
  /** The Stellar account whose trustline changed. */
  account: AccountAddress;
  /** The asset for the trustline (e.g., "USDC:GISSUER" or "XLM"). */
  asset: string;
  /** The trustline limit as a string (Horizon scaled int64). */
  limit: string;
  /** ISO 8601 timestamp of the trustline change. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Horizon API. */
  raw?: RawHorizonChangeTrust;
} & ClassicEventIdentity;

/**
 * A normalized account merge event from the Stellar network.
 */
export type AccountMergeEvent = {
  /** The type of account merge event. */
  type: AccountMergeEventType;
  /** The Stellar account that was merged into another. */
  source: AccountAddress;
  /** The Stellar account that received the merged balance. */
  destination: AccountAddress;
  /** ISO 8601 timestamp of the merge. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Horizon API. */
  raw?: RawHorizonAccountMerge;
} & ClassicEventIdentity;

// ---------------------------------------------------------------------------
// Anchor Events (SEP-24, SEP-31)
// ---------------------------------------------------------------------------

export type Sep24Status =
  | "incomplete"
  | "pending_user_transfer_start"
  | "pending_user_transfer_complete"
  | "pending_external"
  | "pending_anchor"
  | "pending_stellar"
  | "pending_trust"
  | "pending_user"
  | "completed"
  | "refunded"
  | "expired"
  | "no_market"
  | "too_small"
  | "too_large"
  | "error";

export type Sep31Status =
  | "pending_sender"
  | "pending_stellar"
  | "pending_transaction_info_update"
  | "pending_receiver"
  | "pending_external"
  | "completed"
  | "error";

/**
 * @deprecated Use the `anchor.deposit.*` / `anchor.withdrawal.*` /
 * `anchor.payment.*` family ({@link AnchorFlowEvent}) instead. This single
 * catch-all event forces consumers to branch on `protocol` and a raw status
 * string; the flow events carry the lifecycle in the type. Kept so the shape
 * shipped in #942 still narrows, and scheduled for removal before `v2.0.0`.
 */
export type AnchorTransactionEvent = {
  type: "anchor.transaction_status_changed";
  protocol: "sep24" | "sep31";
  transaction_id: string;
  status: string; // The normalized status, or just the raw status
  protocol_status: Sep24Status | Sep31Status;
  message?: string;
  amount_in?: string;
  amount_out?: string;
  timestamp: string;
  readonly timestampDate: Date;
  raw?: unknown;
};

/** The anchor protocol an event came from. */
export type AnchorProtocol = "sep24" | "sep31";

/**
 * Lifecycle stage of an anchor flow, shared by deposits, withdrawals and
 * cross-border payments so a consumer can branch on the stage without caring
 * which SEP produced it.
 *
 * - `initiated` - the anchor has accepted the request and returned an id
 * - `pending` - waiting on the user, the anchor, an external rail, or Stellar
 * - `completed` - funds delivered; terminal
 * - `refunded` - returned to the sender; terminal
 * - `failed` - errored, expired, or rejected; terminal
 */
export type AnchorFlowStage = "initiated" | "pending" | "completed" | "refunded" | "failed";

/** Event types for SEP-24 deposits. */
export type AnchorDepositEventType =
  | "anchor.deposit.initiated"
  | "anchor.deposit.pending"
  | "anchor.deposit.completed"
  | "anchor.deposit.refunded"
  | "anchor.deposit.failed";

/** Event types for SEP-24 withdrawals. */
export type AnchorWithdrawalEventType =
  | "anchor.withdrawal.initiated"
  | "anchor.withdrawal.pending"
  | "anchor.withdrawal.completed"
  | "anchor.withdrawal.refunded"
  | "anchor.withdrawal.failed";

/** Event types for SEP-31 cross-border payments between anchors. */
export type AnchorPaymentEventType =
  | "anchor.payment.initiated"
  | "anchor.payment.pending"
  | "anchor.payment.completed"
  | "anchor.payment.refunded"
  | "anchor.payment.failed";

export type AnchorFlowEventType =
  AnchorDepositEventType | AnchorWithdrawalEventType | AnchorPaymentEventType;

/**
 * A normalized anchor lifecycle event.
 *
 * Off-chain anchor state and on-chain settlement are two views of one payment.
 * These events carry the anchor's own status verbatim in `protocolStatus`
 * alongside the normalized `type`, so nothing is lost for a compliance
 * consumer, and expose the settlement transaction in `settlementTxHash` when -
 * and only when - the anchor published it.
 */
export type AnchorFlowEvent = {
  /** Normalized lifecycle event type. */
  type: AnchorFlowEventType;
  /** Which SEP the transaction belongs to. */
  protocol: AnchorProtocol;
  /** Lifecycle stage, duplicated from `type` for consumers that switch on it. */
  stage: AnchorFlowStage;
  /** The anchor's transaction id. */
  transactionId: string;
  /**
   * The anchor's own status string, unmodified. `type` is the normalization;
   * this is the source of truth a compliance consumer needs.
   */
  protocolStatus: Sep24Status | Sep31Status;
  /** Base URL of the anchor that reported this transaction. */
  anchorUrl: string;
  /**
   * Hash of the Stellar transaction that settled this flow, or `null` when the
   * anchor did not expose one. Never inferred - a hash guessed from timing
   * would be indistinguishable from fabricated data.
   */
  settlementTxHash: string | null;
  /** Amount received by the anchor, when reported. */
  amountIn?: string;
  /** Amount delivered by the anchor, when reported. */
  amountOut?: string;
  /** Fee charged by the anchor, when reported. */
  amountFee?: string;
  /** Human-readable message from the anchor, when reported. */
  message?: string;
  /** ISO 8601 timestamp of the transition. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The raw transaction record the anchor returned. */
  raw?: unknown;
};

/**
 * A normalized CAP-67 unified-stream clawback event. Unlike `mint`/`burn`
 * (which normalize onto the existing `payment.received`/`payment.sent`
 * shape for parity with Horizon), clawback has no Horizon-derived
 * equivalent in this package, so it gets its own taxonomy entry.
 */
export type AssetClawbackEvent = {
  /** The type of clawback event. */
  type: AssetClawbackEventType;
  /** The account or muxed account the asset was clawed back from. */
  from: AccountAddress | MuxedAddress;
  /** The asset clawed back (e.g. "USDC:GISSUER"). */
  asset: string;
  /** The clawed-back amount. */
  amount: StellarAmount;
  /** ISO 8601 timestamp of the clawback. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the unified Soroban event stream. */
  raw?: RawSorobanEvent;
};

/**
 * A normalized CAP-67 unified-stream `fee` event: a classic transaction's
 * network fee, now emitted as a discrete event. New in CAP-67 - no
 * Horizon-derived equivalent exists in this package's current taxonomy.
 */
export type FeeIncurredEvent = {
  /** The type of fee event. */
  type: FeeIncurredEventType;
  /** The account or muxed account that paid the fee. Contract payers are rejected during normalization. */
  from: AccountAddress | MuxedAddress;
  /** The fee amount (always native XLM). */
  amount: StellarAmount;
  /** ISO 8601 timestamp of the fee event. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the unified Soroban event stream. */
  raw?: RawSorobanEvent;
};

/**
 * A union of all normalized events supported by pulse-core.
 *
 * This is the broad catch-all type. For precise type narrowing and better
 * autocompletion, prefer the per-event types available under the `events`
 * namespace export:
 *
 * ```ts
 * import type { events } from "@orbital-stellar/pulse-core";
 * type Payment = events.PaymentEvent;
 * type AccountCreated = events.AccountCreatedEvent;
 * ```
 *
 * @see {@link events} for the full list of narrower per-event types.
 *
 * Every event exposes a lazy, cached `timestampDate` getter derived from
 * `event.timestamp`.  The Date is parsed on first access and memoised;
 * subsequent accesses return the same instance.  The property is
 * **non-enumerable** so `JSON.stringify` output is unaffected.
 */
export type NormalizedEvent = (
  | PaymentEvent
  | AccountOptionsEvent
  | AccountCreatedEvent
  | TrustlineEvent
  | AccountMergeEvent
  | OfferEvent
  | BumpSequenceEvent
  | DataEvent
  | ClaimableCreatedEvent
  | ClaimableClaimedEvent
  | LiquidityPoolDepositEvent
  | LiquidityPoolWithdrawEvent
  | TrustAuthEvent
  | AssetClawbackEvent
  | FeeIncurredEvent
  | ContractEvent
  | AnchorTransactionEvent
  | AnchorFlowEvent
) & {
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** Which network this event came from. Only set when `EventEngine` was constructed with multiple network sources (`CoreConfig.network` as an array). */
  network?: Network;
};

/**
 * A notification emitted by the EventEngine during reconnection attempts.
 *
 * @example
 * watcher.on("engine.reconnecting", (notification) => {
 *   console.log(`Reconnect attempt ${notification.attempt} in ${notification.delayMs}ms`);
 * });
 */
export type WatcherNotification = {
  /** The type of reconnection notification. */
  type: WatcherNotificationType;
  /** Human-friendly label of the subscription that received this notification, if one was set. */
  name?: string;
  /** The current reconnection attempt number. */
  attempt: number;
  /** The delay in milliseconds before the next reconnection attempt (for "engine.reconnecting" events). */
  delayMs?: number;
  /** The cursor position at the time of failure (for "engine.reconnecting" events). */
  cursor?: string;
  /** The source that triggered this notification. */
  source?: "horizon" | "soroban" | "unified";
  /** Backpressure active flag (for `engine.backpressure`). */
  active?: boolean;
  /** Number of events currently queued inside the engine. */
  queued?: number;
  /** Queue policy in effect when backpressure was emitted. */
  policy?: string;
  /** ISO 8601 timestamp of when this notification was emitted. */
  emittedAt: string;
  /** The cursor value that was expired or lost, if applicable. */
  lostCursor?: string;
};

/**
 * Configuration for automatic reconnection logic in EventEngine.
 */
export type ReconnectConfig = {
  /** Initial delay in milliseconds before the first reconnection attempt. Defaults to 1000. */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between reconnection attempts. Defaults to 30000. */
  maxDelayMs?: number;
  /** Maximum number of reconnection attempts. Defaults to Infinity. */
  maxRetries?: number;
};

/**
 * Structured logger interface accepted by EventEngine.
 *
 * The second argument carries metadata that downstream loggers can serialize as JSON
 * or map into their own structured logging format.
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  /** Optional verbose channel for per-request / per-event diagnostics. */
  debug?(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Minimal interface for an ABI registry client.
 * Satisfied by `AbiRegistryClient` from `@orbital-stellar/abi-registry`, or any
 * object with a compatible `getSpec` method (useful for testing).
 */
export interface AbiRegistryClientLike {
  getSpec(contractId: string): Promise<unknown>;
  /**
   * Optional ledger-versioned spec lookup. When implemented, `EventEngine`
   * calls it with the emitting event's `ledger` instead of `getSpec`, so a
   * contract that upgraded mid-stream decodes against the spec at its
   * ledger rather than the latest one.
   */
  getSpecAt?(contractId: string, ledger: number): Promise<unknown>;
}

export type SorobanConfig = {
  /** Soroban RPC endpoint used for live contract-event polling. */
  rpcUrl: string;
  /** Optional headers forwarded to the Soroban RPC endpoint. */
  rpcHeaders?: Record<string, string>;
  /** Interval between Soroban polls in milliseconds. Defaults to 2,000. */
  pollIntervalMs?: number;
  /** Number of ledgers to look back from the latest ledger on the first poll. Defaults to 0. */
  startLedgerLookback?: number;
  /**
   * Pagination limit for each Soroban RPC `getEvents` call.
   * Must be an integer from 1 through 10,000. Defaults to 100.
   */
  pageLimit?: number;
  /**
   * Opt into the CAP-67 unified event poller (`SorobanRpcClient.pollUnifiedEvents`) -
   * a first-class transport, started/stopped alongside Horizon SSE and the
   * contract-filter `SorobanSubscriber`, that polls the same RPC endpoint for
   * classic-asset `transfer`/`mint`/`burn`/`clawback` events. Off by default.
   * Decoding, normalizing, and dispatching those events to watchers is not
   * yet wired - only the transport's start/stop/status/reconnect lifecycle is.
   */
  unifiedEvents?: boolean;
};

/**
 * One network's connection details in a multi-network `CoreConfig.network` array.
 * Each source becomes an independent, internally-managed single-network
 * `EventEngine` - same reconnect/cursor/decode behavior as a standalone engine,
 * just fanned out and merged under one parent engine.
 */
export type NetworkSourceConfig = {
  /** The Stellar network this source connects to. */
  network: Network;
  /** Optional override for this source's Horizon server URL. See `CoreConfig.horizonUrl`. */
  horizonUrl?: string;
  /** Optional Soroban RPC configuration for this source. Each network typically needs its own `rpcUrl`. */
  soroban?: SorobanConfig;
};

export type CoreConfig = {
  /**
   * The Stellar network to connect to. Pass an array of `NetworkSourceConfig`
   * to run Horizon (+ optionally Soroban RPC) against multiple networks from
   * one engine - e.g. mirroring testnet and mainnet simultaneously. Events
   * from a multi-network engine carry a `network` field identifying their
   * source, and `status()` reports a per-network breakdown via `networks`.
   */
  network: Network | NetworkSourceConfig[];
  /** Optional override for the Horizon server URL. When set, `network` is still used for chain context but the connection is made to this URL. Useful for private nodes, regional mirrors, or futurenet. Ignored when `network` is an array - set `horizonUrl` per source instead. */
  horizonUrl?: string;
  /** Optional reconnection configuration. Applied to every source when `network` is an array. */
  reconnect?: ReconnectConfig;
  logger?: Logger;
  /** Optional cursor store for resumable streams. Shared across sources when `network` is an array; each source's cursor key is still scoped independently. */
  cursorStore?: CursorStoreLike;
  /** Key to use for cursor storage. Defaults to "pulse-core-cursor". When `network` is an array, each source's key is derived as `${streamKey}:${network}`. */
  streamKey?: string;
  /** Number of consecutive cursor store failures before marking it unhealthy. Defaults to 5. */
  cursorFailureThreshold?: number;
  /**
   * ABI registry client used to enrich `contract.emitted` events with
   * `decodedData`. Defaults to resolving the bundled well-known specs (and,
   * once deployed, Orbital's on-chain registry) when omitted - pass
   * `false` to opt out of registry resolution entirely and keep
   * `decodedData` always `undefined`, or pass an explicit client to use
   * only that client.
   */
  abiRegistry?: AbiRegistryClientLike | false;
  /** Soroban RPC configuration. Ignored when `network` is an array - set `soroban` per source instead. */
  soroban?: SorobanConfig;
  /**
   * Which event transport to prefer: `"horizon"` (default) preserves
   * pre-Wave-1.6 behavior exactly - zero change until a consumer opts in.
   * `"unified"` prefers the CAP-67 unified stream where one exists.
   * `"auto"` picks between the two based on what the configured Soroban RPC
   * supports. Throws {@link InvalidIngestionModeError} for any other value.
   *
   * This is config surface only - selecting a mode here doesn't yet change
   * which transport actually delivers which events; that routing behavior
   * is separate, forthcoming work.
   */
  ingestion?: IngestionMode;
  /** Optional internal event queue tuning. */
  queue?: {
    /** High water mark for the internal engine queue. Defaults to 10000. */
    highWaterMark?: number;
    /** Low water mark at which backpressure is considered cleared. Defaults to 50% of highWaterMark. */
    lowWaterMark?: number;
    /** Backpressure policy: 'pause' | 'drop-oldest' | 'drop-newest'. Defaults to 'pause'. */
    policy?: "pause" | "drop-oldest" | "drop-newest";
  };
};

/** Valid values for {@link CoreConfig.ingestion}. */
export type IngestionMode = "unified" | "horizon" | "auto";

/**
 * The event families this package's `NormalizedEvent` taxonomy is grouped
 * into for transport-routing purposes (see {@link resolveFamilyTransport}).
 * Every family corresponds to one or more Horizon operation types; `payment`
 * and `trustlineAuth` are the only ones with a CAP-67 unified equivalent
 * today (transfer/mint/burn/clawback, and set_authorized, respectively) -
 * every other family has no unified equivalent per the CAP-67 mapping design
 * doc (`docs/design/cap67-mapping.md`) and stays Horizon-only regardless of
 * ingestion mode.
 */
export type EventFamily =
  | "payment"
  | "trustlineAuth"
  | "trustlineLimit"
  | "accountCreated"
  | "accountOptions"
  | "accountMerge"
  | "offer"
  | "bumpSequence"
  | "manageData"
  | "claimableBalance"
  | "liquidityPool";

/** Event families with a CAP-67 unified-stream equivalent per the mapping design doc. */
const UNIFIED_EQUIVALENT_FAMILIES: ReadonlySet<EventFamily> = new Set<EventFamily>([
  "payment",
  "trustlineAuth",
]);

/**
 * Decides which transport should serve a given event family under a given
 * effective mode (`"unified"` or `"horizon"` - resolving what mode is
 * actually in effect, e.g. for an `"auto"`-style setting, is left to the
 * caller). Pure and total: safe to call for every family without touching
 * any engine state.
 *
 * This is the routing *decision* only. A family resolving to `"unified"`
 * here reflects the CAP-67 mapping design doc's target architecture; whether
 * an `EventEngine` actually stops delivering that family via Horizon and
 * starts delivering it via the unified stream additionally depends on a
 * working decoder/normalizer existing for it.
 */
export function resolveFamilyTransport(
  family: EventFamily,
  effectiveMode: "unified" | "horizon",
): "unified" | "horizon" {
  if (effectiveMode === "horizon") return "horizon";
  return UNIFIED_EQUIVALENT_FAMILIES.has(family) ? "unified" : "horizon";
}

// Error class for invalid network validation
export class UnknownNetworkError extends Error {
  constructor(network: string) {
    const validNetworks = ["mainnet", "testnet"].join(", ");
    super(`Unknown network: "${network}". Valid networks: ${validNetworks}`);
    this.name = "UnknownNetworkError";
  }
}

export type HealthCheckResult = {
  ok: boolean;
  reasons: string[];
};

export type SubscribeOptions = {
  /** Optional predicate applied before each event is emitted to this watcher.
   *  Return `false` to suppress delivery. If the predicate throws, the event
   *  is suppressed and a warning is logged - the engine continues running. */
  filter?: (event: NormalizedEvent) => boolean;
  /** Optional human-friendly label for observability - appears in log lines and lifecycle notifications. */
  name?: string;
};

// ---------------------------------------------------------------------------
// Contract events (Phase 1 - Soroban)
// ---------------------------------------------------------------------------

export type ContractEventType = "contract.invoked" | "contract.emitted";

/**
 * A normalized Soroban contract invocation event.
 * Emitted when a contract function is called.
 */
export type ContractInvokedEvent = {
  type: "contract.invoked";
  contractId: ContractAddress;
  /** The function name that was invoked. */
  function: string;
  /** Ordered list of arguments passed to the function. */
  args: unknown[];
  /** The ledger sequence number where the invocation occurred, when available. */
  ledger?: number;
  /** The transaction hash of the transaction containing this invocation, when available. */
  txHash?: string;
  /** ISO 8601 timestamp of the invocation. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Soroban API. */
  raw?: RawSorobanEvent;
  decodedData?: unknown;
  inSuccessfulContractCall?: boolean;
};

/**
 * A normalized Soroban contract-emitted event (contract_events in the ledger).
 */
export type ContractEmittedEvent = {
  type: "contract.emitted";
  contractId: ContractAddress;
  /** Ordered list of topic strings (XDR-encoded or decoded). */
  topics: string[];
  /** Arbitrary event data payload. */
  data: unknown;
  /**
   * ABI-decoded event data, populated when an `abiRegistry` is configured
   * and a spec is found for the contract. Undefined on a registry miss,
   * decode error, or when no registry is configured.
   */
  decodedData?: unknown;
  /** Ledger sequence number where the event was emitted, when available. */
  ledger?: number;
  /** Unique event identifier from the Soroban RPC, when available. */
  eventId?: string;
  /** Transaction hash containing this event, when available. */
  txHash?: string;
  /** Whether the emitting contract call succeeded, when available. */
  inSuccessfulContractCall?: boolean;
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record from the Soroban API. */
  raw?: RawSorobanEvent;
};

/** Discriminated union of every normalized Soroban contract event. */
export type ContractEvent = ContractInvokedEvent | ContractEmittedEvent;

export type DecodeFailedNotification = {
  type: "event.decode_failed";
  contractId: ContractAddress;
  eventId?: string;
  error: string;
};

/**
 * Emitted when `EventEngine` receives a record whose `type` field does not
 * match any recognized Horizon or Soroban operation type. Distinct from
 * `DecodeFailedNotification`, which covers ABI-spec lookup failures for
 * already-recognized `contract_event` records.
 */
export type UnrecognizedOperationTypeNotification = {
  type: "engine.unrecognized_operation_type";
  /** The unrecognized value of the record's `type` field. */
  operationType: string;
  /** The raw record that could not be normalized. */
  record: unknown;
};

/**
 * Filter criteria for a contract subscription.
 * All specified fields must match (AND semantics).
 * Omitting a field means "match any".
 */
export type ContractSubscriptionFilter = {
  /** Match only events of this type. Omit to match both. */
  type?: ContractEventType;
  /**
   * Match only events from one of these contract IDs.
   * Omit to match any contract.
   */
  contractIds?: ContractAddress[];
  /**
   * Topic-pattern match: each entry is matched positionally against the event's
   * topics array. Use `null` as a wildcard for a position.
   * Omit to match any topics.
   *
   * @example ["transfer", null] - matches events whose first topic is "transfer"
   */
  topicFilters?: (string | null)[];
};

/** Options for subscribeContract(). */
export type ContractSubscribeOptions = {
  filters?: ContractSubscriptionFilter[];
  filter?: (event: NormalizedEvent) => boolean;
  /** Optional human-friendly label for observability - appears in log lines and lifecycle notifications. */
  name?: string;
};

/**
 * Namespace grouping all per-event named types for precise type narrowing.
 * @see {@link events} for the full list of narrower per-event types.
 *
 * @example
 * import type { events } from "@orbital-stellar/pulse-core";
 * function handlePayment(e: events.PaymentEvent) { ... }
 */
export * as events from "./events.js";

// ---------------------------------------------------------------------------
// Phase 1 - new RPC-shaped contract subscription API
// ---------------------------------------------------------------------------

export type ContractFilter = {
  type?: "system" | "contract" | "diagnostic";
  contractIds?: string[];
  topics?: string[][];
};

export type ContractSubscriptionConfig = {
  filters: ContractFilter[];
};
