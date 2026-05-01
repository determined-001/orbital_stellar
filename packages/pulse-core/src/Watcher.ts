// packages/pulse-core/src/Watcher.ts
import { EventEmitter } from "events";
import type { NormalizedEvent, WatcherNotification } from "./index.js";

type WatcherEvent = NormalizedEvent | WatcherNotification;

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
  private stopHandlers: Set<() => void> = new Set();

  /**
   * Creates a new Watcher for the given Stellar address.
   * @param address - The Stellar address to watch.
   */
  constructor(address: string) {
    super();
    this.address = address;
  }

  /**
   * Registers an event handler for the given event type.
   * If the watcher is stopped, this is a no-op.
   * @param eventType - The event type to listen to (e.g., "payment.received", "account.options_changed", "engine.reconnecting", "*").
   * @param handler - The callback to invoke when the event occurs.
   * @returns This watcher instance for chaining.
   */
  on(eventType: string, handler: (event: WatcherEvent) => void): this {
    if (this._stopped) return this;
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
      return () => { };
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
