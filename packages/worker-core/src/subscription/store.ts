import type { SubscriptionRecord } from "./types.js";

/**
 * Persistence seam. In-memory here; a real deployment backs this with the same
 * Postgres the retry queue uses.
 */
export interface SubscriptionStore {
  get(id: string): Promise<SubscriptionRecord | undefined>;
  put(record: SubscriptionRecord): Promise<void>;
  /** Every subscription belonging to one subscriber, newest first. */
  listBySubscriber(subscriber: string): Promise<SubscriptionRecord[]>;
}

export class MemorySubscriptionStore implements SubscriptionStore {
  private readonly records = new Map<string, SubscriptionRecord>();

  async get(id: string): Promise<SubscriptionRecord | undefined> {
    return this.records.get(id);
  }

  async put(record: SubscriptionRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async listBySubscriber(subscriber: string): Promise<SubscriptionRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.subscriber === subscriber)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
