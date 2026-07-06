import { EventEmitter } from "events";
import type {
  DecodeFailedNotification,
  NormalizedEvent,
  WatcherNotification,
  PaymentEvent,
  AccountOptionsEvent,
  AccountCreatedEvent,
  TrustlineEvent,
  AccountMergeEvent,
  OfferEvent,
  BumpSequenceEvent,
  DataEvent,
  ClaimableCreatedEvent,
  ClaimableClaimedEvent,
  LiquidityPoolDepositEvent,
  LiquidityPoolWithdrawEvent,
  TrustAuthEvent,
  ContractInvokedEvent,
  ContractEmittedEvent,
} from "./index.js";

type WatcherEvent = NormalizedEvent | WatcherNotification | DecodeFailedNotification;

export type WatcherEventMap = {
  "payment.received": PaymentEvent & { readonly timestampDate: Date };
  "payment.sent": PaymentEvent & { readonly timestampDate: Date };
  "payment.self": PaymentEvent & { readonly timestampDate: Date };
  "account.created": AccountCreatedEvent & { readonly timestampDate: Date };
  "account.options_changed": AccountOptionsEvent & { readonly timestampDate: Date };
  "account.merged": AccountMergeEvent & { readonly timestampDate: Date };
  "account.bump_sequence": BumpSequenceEvent & { readonly timestampDate: Date };
  "trustline.added": TrustlineEvent & { readonly timestampDate: Date };
  "trustline.removed": TrustlineEvent & { readonly timestampDate: Date };
  "trustline.updated": TrustlineEvent & { readonly timestampDate: Date };
  "trustline.authorized": TrustAuthEvent & { readonly timestampDate: Date };
  "trustline.deauthorized": TrustAuthEvent & { readonly timestampDate: Date };
  "offer.created": OfferEvent & { readonly timestampDate: Date };
  "offer.updated": OfferEvent & { readonly timestampDate: Date };
  "offer.deleted": OfferEvent & { readonly timestampDate: Date };
  "data.set": DataEvent & { readonly timestampDate: Date };
  "data.cleared": DataEvent & { readonly timestampDate: Date };
  "claimable.created": ClaimableCreatedEvent & { readonly timestampDate: Date };
  "claimable.claimed": ClaimableClaimedEvent & { readonly timestampDate: Date };
  "lp.deposited": LiquidityPoolDepositEvent & { readonly timestampDate: Date };
  "lp.withdrawn": LiquidityPoolWithdrawEvent & { readonly timestampDate: Date };
  "contract.invoked": ContractInvokedEvent & { readonly timestampDate: Date };
  "contract.emitted": ContractEmittedEvent & { readonly timestampDate: Date };
  "engine.reconnecting": WatcherNotification;
  "engine.reconnected": WatcherNotification;
  "engine.rate_limited": WatcherNotification;
  "engine.stopped": WatcherNotification;
  "engine.cursor_store_unhealthy": WatcherNotification;
  "engine.cursor_expired": WatcherNotification;
  "event.decode_failed": DecodeFailedNotification;
  "webhook.failed": NormalizedEvent;
  "webhook.dropped": NormalizedEvent;
  "*": WatcherEvent;
};

type WatcherLogger = Pick<Console, "warn">;

export type WatcherOptions = {
  strictStoppedListeners?: boolean;
  logger?: WatcherLogger;
};

/**
 * Watches for Stellar network events related to a specific address.
 * Extends EventEmitter to provide event-driven notifications.
 *
 * @example
 * const watcher = engine.subscribe("G...");
 * watcher.on("payment.received", (event) => {
 *   console.log("Received payment:", event.amount, event.asset);
 * });
 */
export class Watcher extends EventEmitter {
  readonly address: string;
  private _stopped: boolean = false;
  private readonly strictStoppedListeners: boolean;
  private readonly logger: WatcherLogger;
  private stopHandlers: Set<() => void> = new Set();

  constructor(address: string, options: WatcherOptions = {}) {
    super();
    this.address = address;
    this.strictStoppedListeners = options.strictStoppedListeners ?? false;
    this.logger = options.logger ?? console;
  }

  /**
   * Registers an event handler for the given event type.
   * If the watcher is stopped, this is a no-op.
   * @param eventType - The event type to listen to (e.g., "payment.received", "account.options_changed", "engine.reconnecting", "*").
   * @param handler - The callback to invoke when the event occurs.
   * @returns This watcher instance for chaining.
   */
  on<K extends keyof WatcherEventMap>(
    eventType: K,
    handler: (event: WatcherEventMap[K]) => void,
  ): this;
  on(eventType: string, handler: (event: WatcherEvent) => void): this;
  on(eventType: string, handler: (event: any) => void): this {
    if (this._stopped) {
      const message = `[pulse-core] Watcher.on("${eventType}") called after stop() for address ${this.address}. Listener was not registered.`;

      if (this.strictStoppedListeners) {
        throw new Error(message);
      }

      this.logger.warn(message);
      return this;
    }

    return super.on(eventType, handler);
  }
  /**
   * Emits an event to all registered handlers.
   * If the watcher is stopped, this returns false without emitting.
   * @param eventType - The event type to emit.
   * @param event - The event data.
   * @returns True if the event had listeners, false otherwise.
   */
  emit(eventType: string, event: WatcherEvent): boolean {
    if (this._stopped) return false;
    return super.emit(eventType, event);
  }

  /** Whether this watcher has been stopped. */
  get stopped(): boolean {
    return this._stopped;
  }

  /**
   * Registers a callback to be invoked when the watcher is stopped.
   * If the watcher is already stopped, the handler is invoked immediately.
   * @param handler - The callback to invoke on stop.
   * @returns A function to unregister the handler.
   */
  addStopHandler(handler: () => void): () => void {
    if (this._stopped) {
      handler();
      return () => {};
    }

    this.stopHandlers.add(handler);
    return () => {
      this.stopHandlers.delete(handler);
    };
  }

  /**
   * Stops the watcher and cleans up all resources.
   * Removes all event listeners and invokes all stop handlers.
   * No-op if already stopped.
   */
  stop(): void {
    if (this._stopped) return;
    this._stopped = true;
    for (const handler of this.stopHandlers) {
      handler();
    }
    this.stopHandlers.clear();
    this.removeAllListeners();
  }
}
