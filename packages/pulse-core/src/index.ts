export { SorobanRpcClient } from "./SorobanRpcClient.js";
export type { SorobanRpcClientOptions } from "./SorobanRpcClient.js";
export { EventEngine } from "./EventEngine.js";
export { SorobanSubscriber } from "./SorobanSubscriber.js";
export { validateContractFilters } from "./contractFilters.js";
export { Watcher } from "./Watcher.js";
export { SorobanSubscriber } from "./SorobanSubscriber.js";
export type {
  SorobanSubscriberOptions,
  SorobanRpc,
  SorobanEvent,
  CursorStore as SorobanCursorStore,
} from "./SorobanSubscriber.js";
export { EngineAlreadyStartedError, HorizonStreamError } from "./errors.js";
export { StrKey } from "@stellar/stellar-sdk";
export { CursorStore } from "./CursorStore.js";
export { PostgresCursorStore, PgLike } from "./PostgresCursorStore.js";
export { cacheCursorStore } from "./cacheCursorStore.js";
export { evaluatePredicate, normalizeClaimPredicate, isClaimPredicateType } from "./claimPredicate.js";
export type { ClaimPredicate } from "./claimPredicate.js";
export {
  isAccountAddress,
  isMuxedAddress,
  isContractAddress,
  isStellarAddress,
  toAccountAddress,
  toMuxedAddress,
  toContractAddress,
} from "./address.js";
export type {
  AccountAddress,
  MuxedAddress,
  ContractAddress,
  StellarAddress,
} from "./address.js";

import type { AccountAddress, ContractAddress, MuxedAddress } from "./address.js";

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
  lastEventAt: string | null;
  reconnectAttempt: number;
  sources: {
    horizon: SourceStatus;
    soroban: SourceStatus;
  };
};

/** Passphrase strings for each supported Stellar network. */
export const NETWORK_PASSPHRASES = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
} as const satisfies Record<Network, string>;

/** Event types for payment-related events (received, sent, or self-payment). */
export type PaymentEventType =
  | "payment.received"
  | "payment.sent"
  | "payment.self";
/** Event type for account options changes. */
export type AccountOptionsEventType = "account.options_changed";
export type LiquidityPoolEventType = "lp.deposited" | "lp.withdrawn";
export type TrustAuthEventType =
  | "trustline.authorized"
  | "trustline.deauthorized";
/** Event type for account creation. */
export type AccountEventType = "account.created";
export type ClaimableCreatedEventType = "claimable.created";
export type ClaimableClaimedEventType = "claimable.claimed";
/** Event types for trustline lifecycle events (added, removed, or limit updated). */
export type TrustlineEventType =
  | "trustline.added"
  | "trustline.removed"
  | "trustline.updated";
/** Event type for account merges (one account merged into another). */
export type AccountMergeEventType = "account.merged";
/** Notification types emitted by the EventEngine during reconnection. */
export type WatcherNotificationType =
  | "engine.reconnecting"
  | "engine.reconnected"
  | "engine.rate_limited"
  | "engine.stopped"
  | "engine.cursor_store_unhealthy";

export type OfferEventType =
  | "offer.created"
  | "offer.updated"
  | "offer.deleted";
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
  amount: string;
  /** The asset being transferred (e.g., "XLM" or "ASSET:issuer"). */
  asset: string;
  /** ISO 8601 timestamp of the payment. */
  timestamp: string;
  /** The original raw record from the Horizon API. */
  raw: unknown;
};

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
  /** The original raw record from the Horizon API. */
  raw: unknown;
};

export type OfferEvent = {
  type: OfferEventType;
  offer_id: string;
  source: AccountAddress;
  buying_asset: string;
  selling_asset: string;
  amount: string;
  price: string;
  timestamp: string;
  raw: unknown;
};

export type BumpSequenceEvent = {
  type: BumpSequenceEventType;
  source: AccountAddress;
  bump_to: string;
  timestamp: string;
  raw: unknown;
};

export type ClaimableBalanceClaimant = {
  destination: AccountAddress;
  predicate: unknown;
};

export type ClaimableCreatedEvent = {
  type: ClaimableCreatedEventType;
  sponsor: AccountAddress;
  balanceId: string;
  claimants: ClaimableBalanceClaimant[];
  asset: string;
  amount: string;
  timestamp: string;
  raw: unknown;
};

export type ClaimableClaimedEvent = {
  type: ClaimableClaimedEventType;
  claimant: AccountAddress;
  balanceId: string;
  timestamp: string;
  raw: unknown;
};

export type DataEvent = {
  type: DataEventType;
  source: AccountAddress;
  name: string;
  /** The raw base64-encoded value returned by Horizon, or null when cleared. */
  value: string | null;
  /** The decoded bytes of `value` as a Uint8Array, or null when `value` is null or invalid base64. */
  decoded: Uint8Array | null;
  timestamp: string;
  raw: unknown;
};

export type LiquidityPoolReserve = {
  asset: string;
  amount: string;
};

export type LiquidityPoolDepositEvent = {
  type: "lp.deposited";
  source: AccountAddress;
  pool_id: string;
  reserves_deposited: LiquidityPoolReserve[];
  shares_received: string;
  timestamp: string;
  raw: unknown;
};

export type LiquidityPoolWithdrawEvent = {
  type: "lp.withdrawn";
  source: AccountAddress;
  pool_id: string;
  reserves_received: LiquidityPoolReserve[];
  shares_redeemed: string;
  timestamp: string;
  raw: unknown;
};

export type TrustAuthEvent = {
  type: TrustAuthEventType;
  trustor: AccountAddress;
  issuer: AccountAddress;
  asset: string;
  timestamp: string;
  /** The original Horizon operation type ("allow_trust" or "set_trust_line_flags"). */
  operation: string;
  raw: unknown;
};

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
  /** The original raw record from the Horizon API. */
  raw: unknown;
};

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
  /** The original raw record from the Horizon API. */
  raw: unknown;
};

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
  /** The original raw record from the Horizon API. */
  raw: unknown;
};

/**
 * A union of all normalized events supported by pulse-core.
 *
 * This is the broad catch-all type. For precise type narrowing and better
 * autocompletion, prefer the per-event types available under the `events`
 * namespace export:
 *
 * ```ts
 * import type { events } from "@orbital/pulse-core";
 * type Payment = events.PaymentEvent;
 * type AccountCreated = events.AccountCreatedEvent;
 * ```
 *
 * @see {@link events} for the full list of narrower per-event types.
 */
export type NormalizedEvent =
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
  | ContractInvokedEvent
  | ContractEmittedEvent;

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
  /** ISO 8601 timestamp of when this notification was emitted. */
  emittedAt: string;
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
}

/**
 * Core configuration for initializing the EventEngine.
 *
 * @example
 * const config: CoreConfig = {
 *   network: "testnet",
 *   reconnect: { initialDelayMs: 2000, maxRetries: 5 }
 * };
 */
export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Minimal interface for an ABI registry client.
 * Satisfied by `AbiRegistryClient` from `@orbital/abi-registry`, or any
 * object with a compatible `getSpec` method (useful for testing).
 */
export interface AbiRegistryClientLike {
  getSpec(contractId: string): Promise<unknown>;
}

export type CoreConfig = {
  /** The Stellar network to connect to. */
  network: Network;
  /** Optional override for the Horizon server URL. When set, `network` is still used for chain context but the connection is made to this URL. Useful for private nodes, regional mirrors, or futurenet. */
  horizonUrl?: string;
  /** Optional reconnection configuration. */
  reconnect?: ReconnectConfig;
  logger?: Logger;
};

// Error class for invalid network validation
export class UnknownNetworkError extends Error {
  constructor(network: string) {
    const validNetworks = ["mainnet", "testnet"].join(", ");
    super(`Unknown network: "${network}". Valid networks: ${validNetworks}`);
    this.name = "UnknownNetworkError";
  }
}

export type EngineStatus = {
  running: boolean;
  watcherCount: number;
  contractWatcherCount?: number;
  lastEventAt: string | null;
  reconnectAttempt: number;
  pausedSources?: ("horizon" | "soroban")[];
};

export type HealthCheckResult = {
  ok: boolean;
  reasons: string[];
};

export type SubscribeOptions = {
  /** Optional predicate applied before each event is emitted to this watcher.
   *  Return `false` to suppress delivery. If the predicate throws, the event
   *  is suppressed and a warning is logged — the engine continues running. */
  filter?: (event: NormalizedEvent) => boolean;
  /** Optional human-friendly label for observability — appears in log lines and lifecycle notifications. */
  name?: string;
};

// ---------------------------------------------------------------------------
// Contract events (Phase 1 — Soroban)
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
  /** Ordered list of topic strings (XDR-encoded or decoded). */
  topics: string[];
  /** Arbitrary event data payload. */
  data: unknown;
  timestamp: string;
  raw: unknown;
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
  timestamp: string;
  raw: unknown;
};

export type ContractEvent = ContractInvokedEvent | ContractEmittedEvent;

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
   * @example ["transfer", null] — matches events whose first topic is "transfer"
   */
  topicFilters?: (string | null)[];
};

/** Options for subscribeContract(). */
export type ContractSubscribeOptions = {
  filters?: ContractSubscriptionFilter[];
  /** Optional human-friendly label for observability — appears in log lines and lifecycle notifications. */
  name?: string;
};

/**
 * Namespace grouping all per-event named types for precise type narrowing.
 * @see {@link events} for the full list of narrower per-event types.
 *
 * @example
 * import type { events } from "@orbital/pulse-core";
 * function handlePayment(e: events.PaymentEvent) { ... }
 */
export * as events from "./events.js";
