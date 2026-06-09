import { CursorStore } from "./CursorStore";

export class MemoryCursorStore implements CursorStore {
  private store = new Map<string, string>();

  async get(streamKey: string) {
    return this.store.get(streamKey);
  }

  async set(streamKey: string, cursor: string) {
    this.store.set(streamKey, cursor);
  }
}
