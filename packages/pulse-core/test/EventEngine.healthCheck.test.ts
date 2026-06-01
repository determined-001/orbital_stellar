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
    expect(result.reasons).toContain("engine is not running");
  });

  it("returns ok=false with reason when running but no events received", async () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.start();
    const result = await engine.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("no events received yet");
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
    expect(result.reasons[0]).toMatch(/last event was \d+s ago/);
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
      ping: async () => { throw new Error("db unreachable"); },
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
});
