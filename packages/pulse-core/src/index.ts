export { EventEngine } from "./EventEngine.js";
export { Watcher } from "./Watcher.js";
export { StrKey } from "@stellar/stellar-sdk";

export type Network = "mainnet" | "testnet";

export type PaymentEventType = "payment.received" | "payment.sent";
export type AccountOptionsEventType = "account.options_changed";
export type WatcherNotificationType =
  | "engine.reconnecting"
  | "engine.reconnected";

export type OfferEventType = "offer.created" | "offer.updated" | "offer.deleted";
export type BumpSequenceEventType = "account.bump_sequence";

export type SetOptionsSigner = {
  key: string;
  weight: number;
};

export type AccountOptionsChanges = {
  signer_added?: SetOptionsSigner;
  signer_removed?: SetOptionsSigner;
  thresholds?: {
    low_threshold?: number;
    med_threshold?: number;
    high_threshold?: number;
    master_key_weight?: number;
  };
  home_domain?: string;
};

export type PaymentEvent = {
  type: PaymentEventType;
  to: string;
  from: string;
  amount: string;
  asset: string;
  timestamp: string;
  raw: unknown;
};

export type AccountOptionsEvent = {
  type: AccountOptionsEventType;
  source: string;
  changes: AccountOptionsChanges;
  timestamp: string;
  raw: unknown;
};

export type OfferEvent = {
  type: OfferEventType;
  offer_id: string;
  source: string;
  buying_asset: string;
  selling_asset: string;
  amount: string;
  price: string;
  timestamp: string;
  raw: unknown;
};

export type BumpSequenceEvent = {
  type: BumpSequenceEventType;
  source: string;
  bump_to: string;
  timestamp: string;
  raw: unknown;
};

export type NormalizedEvent =
  | PaymentEvent
  | AccountOptionsEvent
  | OfferEvent
  | BumpSequenceEvent;

export type WatcherNotification = {
  type: WatcherNotificationType;
  attempt: number;
  delayMs?: number;
  timestamp: string;
};

export type ReconnectConfig = {
  initialDelayMs?: number;
  maxDelayMs?: number;
  maxRetries?: number;
};

export type CoreConfig = {
  network: Network;
  reconnect?: ReconnectConfig;
};
