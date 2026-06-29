import { DeadLetterStore, type DeadLetterFilter } from "./MemoryDeadLetterStore.js";

/**
 * List DLQ entries with optional filters and output each as a line‑delimited JSON string.
 */
export function listDLQ(
  store: DeadLetterStore,
  options: { url?: string; since?: string; limit?: number },
): void {
  const filter: DeadLetterFilter = {};
  if (options.url) filter.url = options.url;
  if (options.since) {
    const ms = Date.parse(options.since);
    if (!Number.isNaN(ms)) filter.since = ms;
  }
  if (options.limit !== undefined) filter.limit = options.limit;

  const entries = store.list(filter);
  for (const e of entries) {
    console.log(JSON.stringify(e));
  }
}

/** Dump all DLQ entries as line‑delimited JSON. */
export function dumpDLQ(store: DeadLetterStore): void {
  const entries = store.list();
  for (const e of entries) {
    console.log(JSON.stringify(e));
  }
}

/**
 * Replay a DLQ entry by id. For now this simply re‑adds the entry to the store
 * (simulating a retry) and prints the entry. In a full implementation this would
 * invoke the webhook delivery pipeline.
 */
export function replayDLQ(store: DeadLetterStore, id: string): void {
  const entry = store.get(id);
  if (!entry) {
    console.error(`DLQ entry with id ${id} not found`);
    process.exitCode = 1;
    return;
  }
  // Simulate replay by re‑adding the entry (could be replaced with real delivery).
  store.add(entry.url, entry.event, entry.error, entry.attempts);
  console.log(JSON.stringify(entry));
}
