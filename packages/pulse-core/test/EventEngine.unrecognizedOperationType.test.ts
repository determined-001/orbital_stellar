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
        // The engine asks Horizon for join=transactions; the double mirrors that.
        join() {
          return this;
        },
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

  return {
    Horizon: {
      Server: MockServer,
    },
  };
});

import { EventEngine } from "../src/EventEngine.js";

beforeEach(() => {
  streamInstances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("engine.unrecognized_operation_type", () => {
  it("notifies watchers instead of silently dropping an unrecognized record type", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe("GABC");
    const onUnrecognized = vi.fn();
    watcher.on("engine.unrecognized_operation_type", onUnrecognized);

    engine.start();
    expect(streamInstances).toHaveLength(1);

    const record = {
      type: "some_future_operation_type",
      created_at: "2026-01-01T00:00:00Z",
    };
    streamInstances[0].handlers.onmessage(record);

    expect(onUnrecognized).toHaveBeenCalledTimes(1);
    expect(onUnrecognized).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.unrecognized_operation_type",
        operationType: "some_future_operation_type",
        record,
      }),
    );
  });

  it("does not emit event.decode_failed for an unrecognized record type", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe("GABC");
    const onDecodeFailed = vi.fn();
    watcher.on("event.decode_failed", onDecodeFailed);

    engine.start();
    streamInstances[0].handlers.onmessage({ type: "another_unknown_type" });

    expect(onDecodeFailed).not.toHaveBeenCalled();
  });

  it("notifies contract watchers as well as classic watchers", () => {
    const engine = new EventEngine({ network: "testnet" });
    const contractWatcher = engine.subscribeContract("CAAA");
    const onUnrecognized = vi.fn();
    contractWatcher.on("engine.unrecognized_operation_type", onUnrecognized);

    engine.start();
    streamInstances[0].handlers.onmessage({ type: "totally_unknown" });

    expect(onUnrecognized).toHaveBeenCalledTimes(1);
  });
});
