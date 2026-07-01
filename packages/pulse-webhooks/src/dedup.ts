import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

export interface DedupStore {
  seen(id: string): Promise<boolean>;
  mark(id: string): Promise<void>;
}

export class MemoryDedupStore implements DedupStore {
  private readonly ids = new Set<string>();

  async seen(id: string): Promise<boolean> {
    return this.ids.has(id);
  }

  async mark(id: string): Promise<void> {
    this.ids.add(id);
  }

  clear(): void {
    this.ids.clear();
  }
}

export type DedupReceiverOptions = {
  idExtractor?: (event: NormalizedEvent) => string;
};

const DEFAULT_ID_EXTRACTOR = (event: NormalizedEvent): string => {
  const id = (event as Record<string, unknown>).raw as Record<string, unknown> | null | undefined;
  if (id != null && typeof id.id === "string") return id.id;
  throw new Error("dedupReceiver: event has no raw.id string — provide a custom idExtractor");
};

export function dedupReceiver(
  handler: (event: NormalizedEvent) => Promise<void>,
  store: DedupStore,
  options?: DedupReceiverOptions,
): (event: NormalizedEvent) => Promise<void> {
  const extractId = options?.idExtractor ?? DEFAULT_ID_EXTRACTOR;

  return async (event: NormalizedEvent): Promise<void> => {
    const id = extractId(event);
    if (await store.seen(id)) return;
    await store.mark(id);
    await handler(event);
  };
}
