// packages/pulse-core/test/fakes/FakeSorobanRpc.ts

export interface FakeSorobanEvent {
  id: string;
  pagingToken: string;
  topic: string[];
  value: string;
}

export class FakeSorobanRpc {
  private events: FakeSorobanEvent[] = [];
  public callCount = 0;

  constructor() {
    // Generate 200 deterministic mock events with sequential string tokens
    for (let i = 1; i <= 200; i++) {
      const token = i.toString().padStart(6, "0"); // "000001", "000002", etc.
      this.events.push({
        id: `evt-${token}`,
        pagingToken: token,
        topic: ["transfer"],
        value: `value-${i}`,
      });
    }
  }

  /**
   * Simulates fetching events from Soroban RPC with limit-based pagination
   */
  async getEvents(startCursor: string | undefined, limit = 100): Promise<{ events: FakeSorobanEvent[] }> {
    this.callCount++;
    
    // Find where to resume slicing based on the provided cursor token
    const startIndex = startCursor 
      ? this.events.findIndex(e => e.pagingToken === startCursor) + 1 
      : 0;

    if (startIndex < 0 || startIndex >= this.events.length) {
      return { events: [] };
    }

    // Return the specific page requested by the subscriber
    const page = this.events.slice(startIndex, startIndex + limit);
    return { events: page };
  }
}

