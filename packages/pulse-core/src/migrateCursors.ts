import { CursorStore } from "./CursorStore.js";

export interface MigrateCursorsResult {
  migrated: number;
}

export async function migrateCursors(
  source: CursorStore,
  target: CursorStore
): Promise<MigrateCursorsResult> {
  if (!source.getAll) {
    throw new Error("Source cursor store does not support getAll()");
  }
  const entries = await source.getAll();
  for (const entry of entries) {
    await target.set(entry.streamKey, entry.cursor);
  }
  return { migrated: entries.length };
}
