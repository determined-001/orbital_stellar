// packages/pulse-core/src/Watcher.ts
import { EventEmitter } from "events";
import type { NormalizedEvent } from "./index.js";

export class Watcher extends EventEmitter {
  readonly address: string;
  onStop?: (address: string) => void;
  private _stopped: boolean = false;
  private stopHandlers: Set<() => void> = new Set();

  constructor(address: string) {
    super();
    this.address = address;
  }

  on(eventType: string, handler: (event: NormalizedEvent) => void): this {
    if (this._stopped) return this;
    return super.on(eventType, handler);
  }

  emit(eventType: string, event: NormalizedEvent): boolean {
    if (this._stopped) return false;
    return super.emit(eventType, event);
  }

  get stopped(): boolean {
    return this._stopped;
  }

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

  stop(): void {
    if (this._stopped) return;
    this._stopped = true;
    for (const handler of this.stopHandlers) {
      handler();
    }
    this.stopHandlers.clear();
    this.removeAllListeners();
    this.onStop?.(this.address);
  }
}
