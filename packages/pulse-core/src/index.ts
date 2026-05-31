export { EventEngine } from "./EventEngine.js";
export { Watcher } from "./Watcher.js";
export { StrKey } from "@stellar/stellar-sdk";

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

export type PaymentEventType = "payment.received" | "payment.sent";
export type WatcherNotificationType =
  | "engine.reconnecting"
  | "engine.reconnected";

export type NormalizedEvent = {
  type: PaymentEventType;
  to: string;
  from: string;
  amount: string;
  asset: string;
  timestamp: string;
  raw: unknown;
};

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
