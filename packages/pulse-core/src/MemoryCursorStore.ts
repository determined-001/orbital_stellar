import { CursorStore } from "./CursorStore.js";

export class MemoryCursorStore extends CursorStore {
  private store = new Map<string, string>();

  async get(streamKey: string): Promise<string | null> {
    return this.store.get(streamKey) ?? null;
  }

  async set(streamKey: string, cursor: string): Promise<void> {
    this.store.set(streamKey, cursor);
  }
}
