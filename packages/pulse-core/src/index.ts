export { EventEngine } from "./EventEngine.js";
export { Watcher } from "./Watcher.js";
export { StrKey } from "@stellar/stellar-sdk";

/** The Stellar network to connect to. */
export type Network = "mainnet" | "testnet";

/** Event types for payment-related events (received, sent, or self-payment). */
export type PaymentEventType =
  | "payment.received"
  | "payment.sent"
  | "payment.self";
/** Event type for account options changes. */
export type AccountOptionsEventType = "account.options_changed";
/** Notification types emitted by the EventEngine during reconnection. */
export type WatcherNotificationType =
  | "engine.reconnecting"
  | "engine.reconnected";

/**
 * Represents a signer in Stellar account options.
 */
export type SetOptionsSigner = {
  /** The public key of the signer. */
  key: string;
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
  to: string;
  /** The source address of the payment. */
  from: string;
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
  source: string;
  /** The specific changes made to the account options. */
  changes: AccountOptionsChanges;
  /** ISO 8601 timestamp of the options change. */
  timestamp: string;
  /** The original raw record from the Horizon API. */
  raw: unknown;
};

/**
 * A union of all normalized events supported by pulse-core.
 */
export type NormalizedEvent = PaymentEvent | AccountOptionsEvent;

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
  /** The current reconnection attempt number. */
  attempt: number;
  /** The delay in milliseconds before the next reconnection attempt (for "engine.reconnecting" events). */
  delayMs?: number;
  /** ISO 8601 timestamp of the notification. */
  timestamp: string;
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
 * Core configuration for initializing the EventEngine.
 *
 * @example
 * const config: CoreConfig = {
 *   network: "testnet",
 *   reconnect: { initialDelayMs: 2000, maxRetries: 5 }
 * };
 */
export type CoreConfig = {
  /** The Stellar network to connect to. */
  network: Network;
  /** Optional reconnection configuration. */
  reconnect?: ReconnectConfig;
  logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
};
