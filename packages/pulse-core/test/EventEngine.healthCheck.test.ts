import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = {
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};

const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    operations() {
      return {
        cursor() {
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ handlers, close });
              return close;
            },
          };
        },
      };
    }
  }
  return { Horizon: { Server: MockServer } };
});

import { EventEngine } from "../src/EventEngine.js";

beforeEach(() => {
  streamInstances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("engine.healthCheck()", () => {
  it("returns ok=false with reason when engine is not running", async () => {
    const engine = new EventEngine({ network: "testnet" });
    const result = await engine.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("horizon source is not running");
  });

  it("returns ok=false with reason when running but no events received", async () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();
    const result = await engine.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("horizon source: no events received yet");
  });

  it("returns ok=true when running and last event is within threshold", async () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();
    engine.subscribe("GABC");
    // Simulate a recent event by emitting through the stream
    streamInstances[0]!.handlers.onmessage({
      type: "payment",
      id: "1",
      paging_token: "1",
      created_at: new Date().toISOString(),
      transaction_successful: true,
      source_account: "GABC",
      from: "GABC",
      to: "GDEF",
      amount: "10.0000000",
      asset_type: "native",
    });
    const result = await engine.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("returns ok=false when last event exceeds default threshold (5 min)", async () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();
    engine.subscribe("GABC");
    streamInstances[0]!.handlers.onmessage({
      type: "payment",
      id: "1",
      paging_token: "1",
      created_at: new Date().toISOString(),
      transaction_successful: true,
      source_account: "GABC",
      from: "GABC",
      to: "GDEF",
      amount: "10.0000000",
      asset_type: "native",
    });
    // Advance time past the 5-minute default threshold
    vi.advanceTimersByTime(6 * 60 * 1000);
    const result = await engine.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.reasons[0]).toMatch(/horizon source: last event was \d+s ago/);
  });

  it("respects a custom threshold", async () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();
    engine.subscribe("GABC");
    streamInstances[0]!.handlers.onmessage({
      type: "payment",
      id: "1",
      paging_token: "1",
      created_at: new Date().toISOString(),
      transaction_successful: true,
      source_account: "GABC",
      from: "GABC",
      to: "GDEF",
      amount: "10.0000000",
      asset_type: "native",
    });
    vi.advanceTimersByTime(45 * 1000);
    // 30s threshold — should fail
    expect((await engine.healthCheck(30_000)).ok).toBe(false);
    // 60s threshold — should pass
    expect((await engine.healthCheck(60_000)).ok).toBe(true);
  });

  it("returns ok=false when cursorStore.ping rejects", async () => {
    const cursorStore = {
      get: async () => null,
      set: async () => {},
      ping: async () => {
        throw new Error("db unreachable");
      },
    };
    const engine = new EventEngine({ network: "testnet", cursorStore });
    engine.start();
    engine.subscribe("GABC");
    streamInstances[0]!.handlers.onmessage({
      type: "payment",
      id: "1",
      paging_token: "1",
      created_at: new Date().toISOString(),
      transaction_successful: true,
      source_account: "GABC",
      from: "GABC",
      to: "GDEF",
      amount: "10.0000000",
      asset_type: "native",
    });
    const result = await engine.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes("cursorStore"))).toBe(true);
  });

  describe("with Soroban subscriber", () => {
    function withMockSoroban(
      overrides: Partial<{
        isRunning: boolean;
        lastEventAt: string | null;
      }> = {},
    ): EventEngine {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();
      engine.subscribe("GABC");
      // Set a recent Horizon event so Horizon source passes
      streamInstances[0]!.handlers.onmessage({
        type: "payment",
        id: "1",
        paging_token: "1",
        created_at: new Date().toISOString(),
        transaction_successful: true,
        source_account: "GABC",
        from: "GABC",
        to: "GDEF",
        amount: "10.0000000",
        asset_type: "native",
      });
      // Inject a mock SorobanSubscriber into the private field
      const now = new Date().toISOString();
      const mockSubscriber = {
        isRunning: overrides.isRunning ?? true,
        lastEventAt: overrides.lastEventAt !== undefined ? overrides.lastEventAt : now,
      };
      // @ts-expect-error — accessing private field for test injection
      engine.sorobanSubscriber = mockSubscriber;
      return engine;
    }

    it("returns ok=true when both sources are healthy and recent", async () => {
      const engine = withMockSoroban();
      const result = await engine.healthCheck();
      expect(result.ok).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it("returns ok=false when Soroban subscriber is not running", async () => {
      const engine = withMockSoroban({ isRunning: false, lastEventAt: new Date().toISOString() });
      const result = await engine.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.reasons).toContain("soroban subscriber is not running");
    });

    it("returns ok=false when Soroban subscriber has no events", async () => {
      const engine = withMockSoroban({ lastEventAt: null });
      const result = await engine.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.reasons).toContain("soroban subscriber: no events received yet");
    });

    it("returns ok=false when Soroban subscriber events exceed threshold", async () => {
      const engine = withMockSoroban({ lastEventAt: new Date(0).toISOString() });
      const result = await engine.healthCheck();
      expect(result.ok).toBe(false);
      expect(result.reasons[0]).toMatch(/soroban subscriber: last event was \d+s ago/);
    });
  });
});
