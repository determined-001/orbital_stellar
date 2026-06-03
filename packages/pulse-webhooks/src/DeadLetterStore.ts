export type FailureRecord = {
  eventType: "webhook.failed" | "webhook.dropped";
  webhookId: string;
  payload: unknown;
  reason: string;
  timestamp: number;
  attemptCount: number;
};

export type DeadLetterFilter = {
  eventType?: "webhook.failed" | "webhook.dropped";
  since?: number;
  webhookId?: string;
};

export interface DeadLetterStore {
  record(failure: FailureRecord): void;
  list(filter?: DeadLetterFilter): FailureRecord[];
}

export class MemoryDeadLetterStore implements DeadLetterStore {
  private records: FailureRecord[] = [];
  private readonly cap: number;

  constructor(cap = 1000) {
    this.cap = cap;
  }

  record(failure: FailureRecord): void {
    if (this.records.length >= this.cap) {
      this.records.shift();
    }
    this.records.push(failure);
  }

  list(filter?: DeadLetterFilter): FailureRecord[] {
    if (!filter) {
      return [...this.records];
    }
    return this.records.filter((r) => {
      if (filter.eventType !== undefined && r.eventType !== filter.eventType) return false;
      if (filter.since !== undefined && r.timestamp <= filter.since) return false;
      if (filter.webhookId !== undefined && r.webhookId !== filter.webhookId) return false;
      return true;
    });
  }
}
