import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineAlreadyStartedError } from "../src/errors.js";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = {
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};

const streamInstances: MockStreamInstance[] = [];
const serverUrls: string[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    constructor(url: string) {
      serverUrls.push(url);
    }

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

  return {
    Horizon: {
      Server: MockServer,
    },
  };
});

import { EventEngine } from "../src/EventEngine.js";
import { Watcher } from "../src/Watcher.js";

function latestStream(): MockStreamInstance {
  const stream = streamInstances.at(-1);
  if (!stream) {
    throw new Error("Expected an active mock stream.");
  }

  return stream;
}

describe("pulse-core EventEngine", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(() => {
    streamInstances.length = 0;
    serverUrls.length = 0;
    vi.useFakeTimers();
    log.info.mockReset();
    log.warn.mockReset();
    log.error.mockReset();
    vi.spyOn(Math, "random").mockReturnValue(1);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("normalizes payments without hardcoding payment.received", () => {
    const engine = new EventEngine({ network: "testnet" });
    const normalize = (
      engine as unknown as {
        normalize(record: unknown): unknown;
      }
    ).normalize.bind(engine);

    const normalized = normalize({
      type: "payment",
      to: "GDEST",
      from: "GSRC",
      amount: "42",
      asset_type: "credit_alphanum4",
      asset_code: "USDC",
      asset_issuer: "GISSUER",
      created_at: "2026-03-26T20:00:00.000Z",
    });

    expect(normalized).toEqual({
      type: "unknown",
      to: "GDEST",
      from: "GSRC",
      amount: "42",
      asset: "USDC:GISSUER",
      timestamp: "2026-03-26T20:00:00.000Z",
      raw: {
        type: "payment",
        to: "GDEST",
        from: "GSRC",
        amount: "42",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GISSUER",
        created_at: "2026-03-26T20:00:00.000Z",
      },
    });
  });

  it("empties the registry via stop handlers when stop() is called", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribe("GABC");
    engine.subscribe("GDEF");

    const registry = (engine as unknown as { registry: Map<string, unknown> }).registry;
    expect(registry.size).toBe(2);

    engine.stop();

    expect(registry.size).toBe(0);
  });

  it("emits engine.stopped to all watchers before tearing them down", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe("GABC");
    const stopped = vi.fn();
    watcher.on("engine.stopped", stopped);

    engine.start();
    engine.stop();

    expect(stopped).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalledWith(
      expect.objectContaining({ type: "engine.stopped", attempt: 0 }),
    );
  });

  it("empties the registry but keeps the stream open when unsubscribeAll() is called", () => {
    const engine = new EventEngine({ network: "testnet" });
    engine.subscribe("GABC");
    engine.subscribe("GDEF");
    engine.start();

    const registry = (engine as unknown as { registry: Map<string, unknown> }).registry;
    expect(registry.size).toBe(2);

    engine.unsubscribeAll();

    expect(registry.size).toBe(0);
    expect(engine.status().running).toBe(true);
    expect(streamInstances).toHaveLength(1);
  });

  it("returns null and warns when a required payment field is missing", () => {
    const engine = new EventEngine({ network: "testnet", logger: log });
    const normalize = (
      engine as unknown as {
        normalize(record: unknown): unknown;
      }
    ).normalize.bind(engine);

    const result = normalize({
      type: "payment",
      from: "GSRC",
      amount: "42",
      asset_type: "native",
      created_at: "2026-03-26T20:00:00.000Z",
    });

    expect(result).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] normalize() dropping payment record.",
      expect.objectContaining({ field: "to", record: expect.any(Object) }),
    );
  });

  it("returns null and warns for each missing required field individually", () => {
    const engine = new EventEngine({ network: "testnet", logger: log });
    const normalize = (
      engine as unknown as {
        normalize(record: unknown): unknown;
      }
    ).normalize.bind(engine);

    const missingFieldCases: Array<[string, Record<string, unknown>]> = [
      ["from", { type: "payment", to: "GDEST", amount: "1", created_at: "2026-01-01T00:00:00Z" }],
      [
        "amount",
        { type: "payment", to: "GDEST", from: "GSRC", created_at: "2026-01-01T00:00:00Z" },
      ],
      ["created_at", { type: "payment", to: "GDEST", from: "GSRC", amount: "1" }],
    ];

    for (const [field, record] of missingFieldCases) {
      log.warn.mockReset();
      const result = normalize(record);
      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] normalize() dropping payment record.",
        expect.objectContaining({ field, record: expect.any(Object) }),
      );
    }
  });

  it("removes stopped watchers from the registry and keeps stop idempotent", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe("GABC");

    expect((engine as unknown as { registry: Map<string, unknown> }).registry.has("GABC")).toBe(
      true,
    );

    watcher.stop();
    watcher.stop();

    expect((engine as unknown as { registry: Map<string, unknown> }).registry.has("GABC")).toBe(
      false,
    );
    expect(engine.subscribe("GABC")).not.toBe(watcher);
  });

  describe("horizonUrl override", () => {
    it("uses a custom horizon URL when provided in config", () => {
      new EventEngine({
        network: "testnet",
        horizonUrl: "https://custom-horizon.example.com",
      });
      expect(serverUrls[0]).toBe("https://custom-horizon.example.com");
    });

    it("throws on an invalid horizon URL", () => {
      expect(
        () =>
          new EventEngine({
            network: "testnet",
            horizonUrl: "not-a-url",
          }),
      ).toThrow("Invalid horizonUrl");
    });

    it("throws on a non-http(s) horizon URL", () => {
      expect(
        () =>
          new EventEngine({
            network: "testnet",
            horizonUrl: "ftp://horizon.example.com",
          }),
      ).toThrow("Invalid horizonUrl");
    });

    it("falls back to network-derived URL when horizonUrl is not set", () => {
      new EventEngine({ network: "testnet" });
      expect(serverUrls[0]).toBe("https://horizon-testnet.stellar.org");
    });

    it("falls back to network-derived URL when horizonUrl is explicitly undefined", () => {
      new EventEngine({
        network: "testnet",
        horizonUrl: undefined,
      });
      expect(serverUrls[0]).toBe("https://horizon-testnet.stellar.org");
    });
  });

  it("warns when registering listeners after a watcher is stopped", () => {
    const warn = vi.fn();
    const watcher = new Watcher("GABC", { logger: { warn } });

    watcher.stop();
    watcher.on("payment.received", vi.fn());

    expect(warn).toHaveBeenCalledWith(
      '[pulse-core] Watcher.on("payment.received") called after stop() for address GABC. Listener was not registered.',
    );
  });

  it("throws in strict mode when registering listeners after stop", () => {
    const watcher = new Watcher("GABC", { strictStoppedListeners: true });

    watcher.stop();

    expect(() => watcher.on("payment.received", vi.fn())).toThrow(
      '[pulse-core] Watcher.on("payment.received") called after stop() for address GABC. Listener was not registered.',
    );
  });

  it("guards start() so duplicate live streams are not opened", () => {
    const engine = new EventEngine({ network: "testnet", logger: log });

    const first = engine.start();
    const second = engine.start();

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(streamInstances).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] EventEngine.start() called while the SSE stream is already active.",
      expect.objectContaining({
        isRunning: true,
        reconnectTimerActive: false,
      }),
    );
  });

  it("start({ strict: true }) throws EngineAlreadyStartedError on duplicate start", () => {
    const engine = new EventEngine({ network: "testnet" });

    engine.start();

    expect(() => engine.start({ strict: true })).toThrowError(EngineAlreadyStartedError);
    expect(streamInstances).toHaveLength(1);
  });

  it("routes self-payments as payment.self exactly once", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe("GSELF");
    const selfHandler = vi.fn();
    const receivedHandler = vi.fn();
    const sentHandler = vi.fn();
    const wildcardHandler = vi.fn();

    watcher.on("payment.self", selfHandler);
    watcher.on("payment.received", receivedHandler);
    watcher.on("payment.sent", sentHandler);
    watcher.on("*", wildcardHandler);

    engine.start();
    latestStream().handlers.onmessage({
      type: "payment",
      to: "GSELF",
      from: "GSELF",
      amount: "25",
      asset_type: "native",
      created_at: "2026-04-28T13:00:00.000Z",
    });

    expect(selfHandler).toHaveBeenCalledOnce();
    expect(selfHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.self", to: "GSELF", from: "GSELF", amount: "25" }),
    );
    expect(receivedHandler).not.toHaveBeenCalled();
    expect(sentHandler).not.toHaveBeenCalled();
    expect(wildcardHandler).toHaveBeenCalledOnce();
    expect(wildcardHandler).toHaveBeenCalledWith(expect.objectContaining({ type: "payment.self" }));
  });

  it("reconnects with exponential backoff and emits watcher notifications", () => {
    const engine = new EventEngine({
      network: "testnet",
      logger: log,
      reconnect: { initialDelayMs: 1000, maxDelayMs: 30000 },
    });

    const watcher = engine.subscribe("GABC");
    const reconnecting = vi.fn();
    const reconnected = vi.fn();
    watcher.on("engine.reconnecting", reconnecting);
    watcher.on("engine.reconnected", reconnected);

    engine.start();

    latestStream().handlers.onerror(new Error("stream dropped"));

    expect(streamInstances[0]?.close).toHaveBeenCalledTimes(1);
    expect(reconnecting).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.reconnecting",
        attempt: 1,
        delayMs: expect.any(Number),
        emittedAt: expect.any(String),
        source: "horizon",
      }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] SSE reconnect attempt scheduled.",
      expect.objectContaining({ attempt: 1, delayMs: 1000 }),
    );
    expect(streamInstances).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(streamInstances).toHaveLength(2);

    latestStream().handlers.onerror(new Error("stream dropped again"));
    expect(streamInstances[1]?.close).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenLastCalledWith(
      "[pulse-core] SSE reconnect attempt scheduled.",
      expect.objectContaining({ attempt: 2, delayMs: 2000 }),
    );

    vi.advanceTimersByTime(2000);
    expect(streamInstances).toHaveLength(3);

    latestStream().handlers.onmessage({
      type: "payment",
      to: "GABC",
      from: "GSRC",
      amount: "10",
      asset_type: "native",
      created_at: "2026-03-26T20:00:00.000Z",
    });

    expect(reconnected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.reconnected",
        attempt: 2,
        emittedAt: expect.any(String),
      }),
    );
    expect(log.info).toHaveBeenCalledWith(
      "[pulse-core] SSE reconnect succeeded.",
      expect.objectContaining({ attempt: 2 }),
    );

    latestStream().handlers.onerror(new Error("stream dropped after recovery"));
    expect(reconnecting).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "engine.reconnecting", attempt: 1, source: "horizon" }),
    );
  });

  it("emits matching attempt numbers in reconnecting and reconnected events", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const engine = new EventEngine({
      network: "testnet",
      logger: log,
      reconnect: {
        initialDelayMs: 500,
        maxDelayMs: 10000,
      },
    });

    const watcher = engine.subscribe("GTEST");
    const reconnecting = vi.fn();
    const reconnected = vi.fn();
    watcher.on("engine.reconnecting", reconnecting);
    watcher.on("engine.reconnected", reconnected);

    engine.start();

    // Trigger first reconnect
    latestStream().handlers.onerror(new Error("connection lost"));

    expect(reconnecting).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.reconnecting",
        attempt: 1,
        delayMs: 500,
        source: "horizon",
      }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] SSE reconnect attempt scheduled.",
      expect.objectContaining({ attempt: 1, delayMs: 500 }),
    );

    // Advance timer to trigger reconnect
    vi.advanceTimersByTime(500);

    // Simulate successful reconnection with a message
    latestStream().handlers.onmessage({
      type: "payment",
      to: "GTEST",
      from: "GSRC",
      amount: "5",
      asset_type: "native",
      created_at: "2026-04-28T12:00:00.000Z",
    });

    // Verify reconnected event has the same attempt number
    expect(reconnected).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.reconnected",
        attempt: 1,
      }),
    );
    expect(log.info).toHaveBeenCalledWith(
      "[pulse-core] SSE reconnect succeeded.",
      expect.objectContaining({ attempt: 1 }),
    );
  });

  it("honors 429 Retry-After and emits engine.rate_limited", () => {
    const engine = new EventEngine({ network: "testnet", logger: log });
    const watcher = engine.subscribe("GABC");
    const rateLimited = vi.fn();
    const reconnecting = vi.fn();

    watcher.on("engine.rate_limited", rateLimited);
    watcher.on("engine.reconnecting", reconnecting);

    engine.start();

    latestStream().handlers.onerror({
      status: 429,
      headers: {
        get: (name: string) => (name.toLowerCase() === "retry-after" ? "5" : null),
      },
    });

    expect(rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.rate_limited",
        attempt: 1,
        delayMs: 5000,
      }),
    );
    expect(reconnecting).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] SSE rate limited by Horizon, reconnect scheduled.",
      expect.objectContaining({ attempt: 1, delayMs: 5000 }),
    );

    vi.advanceTimersByTime(5000);
    expect(streamInstances).toHaveLength(2);
  });

  it("backs off at least 60 seconds when Horizon returns 429 without Retry-After", () => {
    const engine = new EventEngine({ network: "testnet", logger: log });
    const watcher = engine.subscribe("GABC");
    const rateLimited = vi.fn();

    watcher.on("engine.rate_limited", rateLimited);

    engine.start();

    latestStream().handlers.onerror({
      status: 429,
      headers: { get: () => null },
    });

    expect(rateLimited).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "engine.rate_limited",
        attempt: 1,
        delayMs: 60000,
      }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      "[pulse-core] SSE rate limited by Horizon, reconnect scheduled.",
      expect.objectContaining({ attempt: 1, delayMs: 60000 }),
    );
  });

  describe("backoff invariants", () => {
    it("delay reaches maxDelayMs cap on attempt N", () => {
      const engine = new EventEngine({
        network: "testnet",
        logger: log,
        reconnect: { initialDelayMs: 1000, maxDelayMs: 5000 },
      });
      engine.subscribe("GABC");
      engine.start();

      vi.spyOn(Math, "random").mockReturnValue(0.999999);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 1, delayMs: 999 }),
      );
      vi.advanceTimersByTime(1000);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 2, delayMs: 1999 }),
      );
      vi.advanceTimersByTime(2000);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 3, delayMs: 3999 }),
      );
      vi.advanceTimersByTime(4000);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 4, delayMs: 4999 }),
      );
    });

    it("max-retries terminates the loop", () => {
      const engine = new EventEngine({
        network: "testnet",
        logger: log,
        reconnect: { initialDelayMs: 100, maxRetries: 2 },
      });
      engine.subscribe("GABC");
      engine.start();

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 1 }),
      );
      vi.advanceTimersByTime(1000);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 2 }),
      );
      vi.advanceTimersByTime(1000);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.error).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect stopped.",
        expect.objectContaining({ failedAttempts: 2 }),
      );
    });

    it("attempt counter resets after engine.reconnected", () => {
      const engine = new EventEngine({
        network: "testnet",
        logger: log,
        reconnect: { initialDelayMs: 1000 },
      });
      engine.subscribe("GABC");
      engine.start();

      vi.spyOn(Math, "random").mockReturnValue(0.999999);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 1, delayMs: 999 }),
      );
      vi.advanceTimersByTime(1000);

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 2, delayMs: 1999 }),
      );
      vi.advanceTimersByTime(2000);

      latestStream().handlers.onmessage({
        type: "payment",
        to: "GABC",
        from: "X",
        amount: "1",
        created_at: "now",
      });
      expect(log.info).toHaveBeenCalledWith(
        "[pulse-core] SSE reconnect succeeded.",
        expect.objectContaining({ attempt: 2 }),
      );

      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 1, delayMs: 999 }),
      );
    });

    it("jitter test using a seeded-like mock", () => {
      const engine = new EventEngine({
        network: "testnet",
        logger: log,
        reconnect: { initialDelayMs: 1000 },
      });
      engine.subscribe("GABC");
      engine.start();

      vi.spyOn(Math, "random").mockReturnValue(0.5);
      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 1, delayMs: 500 }),
      );

      vi.advanceTimersByTime(500);
      vi.spyOn(Math, "random").mockReturnValue(0.1);
      latestStream().handlers.onerror(new Error("err"));
      expect(log.warn).toHaveBeenLastCalledWith(
        "[pulse-core] SSE reconnect attempt scheduled.",
        expect.objectContaining({ attempt: 2, delayMs: 200 }),
      );
    });
  });

  describe("set_options → account.options_changed", () => {
    function makeSetOptionsRecord(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        type: "set_options",
        source_account: "GSRC",
        created_at: "2026-04-24T10:00:00.000Z",
        ...overrides,
      };
    }

    it("emits account.options_changed with signer_added when signer_weight > 0", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ signer_key: "GNEWSIGNER", signer_weight: 2 }),
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.options_changed",
          source: "GSRC",
          changes: { signer_added: { key: "GNEWSIGNER", weight: 2 } },
          timestamp: "2026-04-24T10:00:00.000Z",
        }),
      );
    });

    it("emits account.options_changed with signer_removed when signer_weight is 0", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ signer_key: "GOLDSIGNER", signer_weight: 0 }),
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { signer_removed: { key: "GOLDSIGNER", weight: 0 } } }),
      );
    });

    it("emits account.options_changed with thresholds when any threshold field is present", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({
          low_threshold: 1,
          med_threshold: 2,
          high_threshold: 3,
          master_key_weight: 1,
        }),
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            thresholds: {
              low_threshold: 1,
              med_threshold: 2,
              high_threshold: 3,
              master_key_weight: 1,
            },
          },
        }),
      );
    });

    it("emits account.options_changed with home_domain when home_domain is present", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(makeSetOptionsRecord({ home_domain: "example.com" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ changes: { home_domain: "example.com" } }),
      );
    });

    it("only includes fields that are actually present in changes", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ home_domain: "stellar.org", low_threshold: 5 }),
      );

      expect(handler).toHaveBeenCalledOnce();
      const payload = handler.mock.calls[0]![0];
      expect(payload.changes).toEqual({
        home_domain: "stellar.org",
        thresholds: { low_threshold: 5 },
      });
      expect(payload.changes).not.toHaveProperty("signer_added");
      expect(payload.changes).not.toHaveProperty("signer_removed");
    });

    it("does not emit when set_options has no recognized changed fields", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(makeSetOptionsRecord({ set_flags: 1 }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("does not route account.options_changed to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const srcWatcher = engine.subscribe("GSRC");
      const otherWatcher = engine.subscribe("GOTHER");
      const srcHandler = vi.fn();
      const otherHandler = vi.fn();
      srcWatcher.on("account.options_changed", srcHandler);
      otherWatcher.on("account.options_changed", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeSetOptionsRecord({ home_domain: "example.com" }));

      expect(srcHandler).toHaveBeenCalledOnce();
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("subscribe() filter predicate", () => {
    const PAYMENT_RECORD = {
      type: "payment",
      to: "GDEST",
      from: "GSRC",
      amount: "100",
      asset_type: "native",
      created_at: "2026-03-26T20:00:00.000Z",
    };

    it("delivers events to a watcher whose filter returns true", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GDEST", {
        filter: (e) => (e as { amount: string }).amount === "100",
      });
      const handler = vi.fn();
      watcher.on("payment.received", handler);

      engine.start();
      latestStream().handlers.onmessage(PAYMENT_RECORD);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "payment.received", amount: "100" }),
      );
    });

    it("suppresses events for a watcher whose filter returns false", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GDEST", {
        filter: (e) => (e as { amount: string }).amount !== "100",
      });
      const handler = vi.fn();
      watcher.on("payment.received", handler);
      watcher.on("*", handler);

      engine.start();
      latestStream().handlers.onmessage(PAYMENT_RECORD);

      expect(handler).not.toHaveBeenCalled();
    });

    it("treats a throwing filter as a reject and logs a warning without crashing the engine", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const filterError = new Error("filter boom");
      const watcher = engine.subscribe("GDEST", {
        filter: () => {
          throw filterError;
        },
      });
      const handler = vi.fn();
      watcher.on("payment.received", handler);

      engine.start();
      latestStream().handlers.onmessage(PAYMENT_RECORD);

      expect(handler).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] subscribe() filter threw for address. Treating as reject.",
        expect.objectContaining({ address: "GDEST", error: filterError }),
      );

      const unfiltered = engine.subscribe("GSRC");
      const sentHandler = vi.fn();
      unfiltered.on("payment.sent", sentHandler);
      latestStream().handlers.onmessage(PAYMENT_RECORD);
      expect(sentHandler).toHaveBeenCalledOnce();
    });

    it("warns and ignores filter when re-subscribing to an already-watched address", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const first = engine.subscribe("GDEST");
      const second = engine.subscribe("GDEST", { filter: () => false });

      expect(second).toBe(first);
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] subscribe() called for an address that already has an active watcher. Filter option ignored.",
        expect.objectContaining({ address: "GDEST", hasFilter: true }),
      );
    });

    it("includes the subscription name in lifecycle notifications and duplicate-subscribe warnings", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const watcher = engine.subscribe("GDEST", { name: "treasury-feed" });
      const reconnecting = vi.fn();
      watcher.on("engine.reconnecting", reconnecting);

      engine.start();
      latestStream().handlers.onerror(new Error("stream dropped"));

      expect(reconnecting).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "engine.reconnecting",
          name: "treasury-feed",
          attempt: 1,
          source: "horizon",
        }),
      );

      const duplicate = engine.subscribe("GDEST", {
        name: "ignored",
        filter: () => false,
      });

      expect(duplicate).toBe(watcher);
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] subscribe() called for treasury-feed (GDEST) which already has an active watcher — filter option ignored.",
      );
    });
  });

  describe("create_account → account.created", () => {
    function makeCreateAccountRecord(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        type: "create_account",
        funder: "GFUNDER",
        account: "GNEW",
        starting_balance: "10.0000000",
        created_at: "2026-04-24T10:00:00.000Z",
        ...overrides,
      };
    }

    it("emits account.created and routes to both funder and account watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const funderWatcher = engine.subscribe("GFUNDER");
      const accountWatcher = engine.subscribe("GNEW");
      const otherWatcher = engine.subscribe("GOTHER");

      const funderHandler = vi.fn();
      const accountHandler = vi.fn();
      const otherHandler = vi.fn();

      funderWatcher.on("account.created", funderHandler);
      accountWatcher.on("account.created", accountHandler);
      otherWatcher.on("account.created", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeCreateAccountRecord({}));

      expect(funderHandler).toHaveBeenCalledOnce();
      expect(funderHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.created",
          funder: "GFUNDER",
          account: "GNEW",
          starting_balance: "10.0000000",
          timestamp: "2026-04-24T10:00:00.000Z",
        }),
      );

      expect(accountHandler).toHaveBeenCalledOnce();
      expect(accountHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.created",
          funder: "GFUNDER",
          account: "GNEW",
          starting_balance: "10.0000000",
          timestamp: "2026-04-24T10:00:00.000Z",
        }),
      );

      expect(otherHandler).not.toHaveBeenCalled();
    });

    it("does not emit account.created if required fields are missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const funderWatcher = engine.subscribe("GFUNDER");
      const funderHandler = vi.fn();
      funderWatcher.on("account.created", funderHandler);

      engine.start();
      latestStream().handlers.onmessage({
        type: "create_account",
        funder: "GFUNDER",
        account: "GNEW",
        // missing starting_balance
        created_at: "2026-04-24T10:00:00.000Z",
      });

      expect(funderHandler).not.toHaveBeenCalled();
    });

    it("does not emit account.created if created_at is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const funderWatcher = engine.subscribe("GFUNDER");
      const funderHandler = vi.fn();
      funderWatcher.on("account.created", funderHandler);

      engine.start();
      latestStream().handlers.onmessage({
        type: "create_account",
        funder: "GFUNDER",
        account: "GNEW",
        starting_balance: "10.0000000",
        // missing created_at
      });

      expect(funderHandler).not.toHaveBeenCalled();
    });

    it("emits only once when funder and account are the same address", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSELF");
      const handler = vi.fn();
      watcher.on("account.created", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeCreateAccountRecord({ funder: "GSELF", account: "GSELF" }),
      );

      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("manage_sell_offer / manage_buy_offer → offer.*", () => {
    function makeOfferRecord(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        type: "manage_sell_offer",
        source_account: "GSRC",
        offer_id: "0",
        amount: "100.0000000",
        buying_asset_type: "native",
        selling_asset_type: "credit_alphanum4",
        selling_asset_code: "USDC",
        selling_asset_issuer: "GISSUER",
        price: "0.5",
        created_at: "2026-04-28T14:00:00.000Z",
        ...overrides,
      };
    }

    it("emits offer.created when offer_id is 0 and amount > 0", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("offer.created", handler);

      engine.start();
      latestStream().handlers.onmessage(makeOfferRecord({ offer_id: "0", amount: "100" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "offer.created",
          offer_id: "0",
          source: "GSRC",
          buying_asset: "XLM",
          selling_asset: "USDC:GISSUER",
          amount: "100",
        }),
      );
    });

    it("emits offer.updated when offer_id > 0 and amount > 0", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("offer.updated", handler);

      engine.start();
      latestStream().handlers.onmessage(makeOfferRecord({ offer_id: "12345", amount: "200" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "offer.updated", offer_id: "12345", amount: "200" }),
      );
    });

    it("emits offer.deleted when amount is 0", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("offer.deleted", handler);

      engine.start();
      latestStream().handlers.onmessage(makeOfferRecord({ offer_id: "12345", amount: "0" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "offer.deleted", offer_id: "12345", amount: "0" }),
      );
    });

    it("works for manage_buy_offer as well", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("offer.created", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeOfferRecord({ type: "manage_buy_offer", offer_id: "0", amount: "50" }),
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "offer.created", amount: "50" }),
      );
    });
  });

  describe("bump_sequence → account.bump_sequence", () => {
    it("emits account.bump_sequence with the new sequence number", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.bump_sequence", handler);

      engine.start();
      latestStream().handlers.onmessage({
        type: "bump_sequence",
        source_account: "GSRC",
        bump_to: "123456789",
        created_at: "2026-04-28T14:00:00.000Z",
      });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.bump_sequence",
          source: "GSRC",
          bump_to: "123456789",
          timestamp: "2026-04-28T14:00:00.000Z",
        }),
      );
    });

    it("does not emit account.bump_sequence if source_account is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.bump_sequence", handler);

      engine.start();
      latestStream().handlers.onmessage({
        type: "bump_sequence",
        bump_to: "123456789",
        created_at: "2026-04-28T14:00:00.000Z",
        // missing source_account
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("manage_data → data.set / data.cleared", () => {
    function makeManageDataRecord(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        type: "manage_data",
        source_account: "GSRC",
        data_name: "federation",
        data_value: "aGVsbG8=",
        created_at: "2026-04-28T14:00:00.000Z",
        ...overrides,
      };
    }

    it("emits data.set when data_value is present", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("data.set", handler);

      engine.start();
      latestStream().handlers.onmessage(makeManageDataRecord());

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "data.set",
          source: "GSRC",
          name: "federation",
          value: "aGVsbG8=",
          timestamp: "2026-04-28T14:00:00.000Z",
        }),
      );
    });

    it("emits data.cleared when data_value is null", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("data.cleared", handler);

      engine.start();
      latestStream().handlers.onmessage(makeManageDataRecord({ data_value: null }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "data.cleared", source: "GSRC", value: null }),
      );
    });

    it("emits data.cleared when data_value is absent", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("data.cleared", handler);

      engine.start();
      const record = makeManageDataRecord();
      delete record.data_value;
      latestStream().handlers.onmessage(record);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "data.cleared", value: null }),
      );
    });

    it("does not emit if source_account is missing", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("*", handler);

      engine.start();
      latestStream().handlers.onmessage(makeManageDataRecord({ source_account: "" }));

      expect(handler).not.toHaveBeenCalled();
    });

    it("does not emit to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.subscribe("GSRC");
      const other = engine.subscribe("GOTHER");
      const otherHandler = vi.fn();
      other.on("*", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeManageDataRecord());

      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("change_trust → trustline.*", () => {
    function makeChangeTrustRecord(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        type: "change_trust",
        source_account: "GSRC",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GISSUER",
        limit: "922337203685.4775807",
        created_at: "2026-04-24T10:00:00.000Z",
        ...overrides,
      };
    }

    it("emits trustline.added for max trustline limit", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("trustline.added", handler);

      engine.start();
      latestStream().handlers.onmessage(makeChangeTrustRecord({}));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "trustline.added",
          account: "GSRC",
          asset: "USDC:GISSUER",
          limit: "922337203685.4775807",
          timestamp: "2026-04-24T10:00:00.000Z",
        }),
      );
    });

    it("emits trustline.removed when limit is zero", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("trustline.removed", handler);

      engine.start();
      latestStream().handlers.onmessage(makeChangeTrustRecord({ limit: "0.0000000" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "trustline.removed", account: "GSRC", limit: "0.0000000" }),
      );
    });

    it("emits trustline.updated when limit is non-zero and not max", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("trustline.updated", handler);

      engine.start();
      latestStream().handlers.onmessage(makeChangeTrustRecord({ limit: "2500.0000000" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "trustline.updated",
          account: "GSRC",
          limit: "2500.0000000",
        }),
      );
    });

    it("does not route trustline events to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const sourceWatcher = engine.subscribe("GSRC");
      const otherWatcher = engine.subscribe("GOTHER");
      const sourceHandler = vi.fn();
      const otherHandler = vi.fn();
      sourceWatcher.on("trustline.updated", sourceHandler);
      otherWatcher.on("trustline.updated", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeChangeTrustRecord({ limit: "3000.0000000" }));

      expect(sourceHandler).toHaveBeenCalledOnce();
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("EventEngine constructor network validation", () => {
    it("throws error with helpful message when network is invalid", () => {
      expect(() => new EventEngine({ network: "invalid_network" as any })).toThrow(
        'Unknown network: "invalid_network". Valid networks: mainnet, testnet',
      );
    });

    it("does not throw when network is mainnet", () => {
      expect(() => new EventEngine({ network: "mainnet" })).not.toThrow();
    });

    it("does not throw when network is testnet", () => {
      expect(() => new EventEngine({ network: "testnet" })).not.toThrow();
    });
  });

  describe("account_merge → account.merged", () => {
    function makeAccountMergeRecord(overrides: Record<string, unknown>): Record<string, unknown> {
      return {
        type: "account_merge",
        account: "GSRC",
        into: "GDEST",
        created_at: "2026-04-26T12:00:00.000Z",
        ...overrides,
      };
    }

    it("normalizes account_merge into account.merged", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const normalized = normalize(makeAccountMergeRecord({}));

      expect(normalized).toEqual({
        type: "account.merged",
        source: "GSRC",
        destination: "GDEST",
        timestamp: "2026-04-26T12:00:00.000Z",
        raw: expect.objectContaining({ type: "account_merge" }),
      });
    });

    it("routes account.merged to both source and destination watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const srcWatcher = engine.subscribe("GSRC");
      const destWatcher = engine.subscribe("GDEST");
      const otherWatcher = engine.subscribe("GOTHER");

      const srcHandler = vi.fn();
      const destHandler = vi.fn();
      const otherHandler = vi.fn();

      srcWatcher.on("account.merged", srcHandler);
      destWatcher.on("account.merged", destHandler);
      otherWatcher.on("account.merged", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeAccountMergeRecord({}));

      expect(srcHandler).toHaveBeenCalledOnce();
      expect(srcHandler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "account.merged", source: "GSRC", destination: "GDEST" }),
      );
      expect(destHandler).toHaveBeenCalledOnce();
      expect(destHandler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "account.merged", source: "GSRC", destination: "GDEST" }),
      );
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("status()", () => {
    it("returns accurate snapshot in initial state", () => {
      const engine = new EventEngine({ network: "testnet" });
      expect(engine.status()).toMatchObject({
        running: false,
        watcherCount: 0,
        lastEventAt: null,
        reconnectAttempt: 0,
      });
    });

    it("returns accurate snapshot after start()", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.subscribe("GABC");
      engine.start();

      expect(engine.status()).toMatchObject({
        running: true,
        watcherCount: 1,
        lastEventAt: null,
        reconnectAttempt: 0,
      });
    });

    it("updates lastEventAt after a message", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const now = "2026-04-27T10:00:00.000Z";
      vi.setSystemTime(new Date(now));
      latestStream().handlers.onmessage({});

      expect(engine.status().lastEventAt).toBe(now);
    });

    it("reflects reconnect attempts and running: false during backoff", () => {
      const engine = new EventEngine({ network: "testnet", reconnect: { initialDelayMs: 1000 } });
      engine.start();

      latestStream().handlers.onerror(new Error("disconnect"));

      expect(engine.status()).toMatchObject({
        running: false,
        watcherCount: 0,
        lastEventAt: null,
        reconnectAttempt: 1,
      });
    });

    it("resets state when stop() is called", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.subscribe("GABC");
      engine.start();
      latestStream().handlers.onmessage({});

      engine.stop();

      expect(engine.status()).toMatchObject({
        running: false,
        watcherCount: 0,
        lastEventAt: null,
        reconnectAttempt: 0,
      });
    });
  });

  describe("create_claimable_balance → claimable.created", () => {
    function makeCreateClaimableRecord(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        type: "create_claimable_balance",
        source_account: "GSPONSOR",
        created_at: "2026-04-28T12:00:00.000Z",
        amount: "100",
        asset_type: "native",
        balance_id: "00000000abc123",
        claimants: [{ destination: "GCLAIMANT1", predicate: { unconditional: true } }],
        ...overrides,
      };
    }

    it("normalizes create_claimable_balance with native asset", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeCreateClaimableRecord());

      expect(result).toEqual({
        type: "claimable.created",
        sponsor: "GSPONSOR",
        balanceId: "00000000abc123",
        claimants: [{ destination: "GCLAIMANT1", predicate: { unconditional: true } }],
        asset: "XLM",
        amount: "100",
        timestamp: "2026-04-28T12:00:00.000Z",
        raw: expect.any(Object),
      });
    });

    it("normalizes create_claimable_balance with credit asset", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(
        makeCreateClaimableRecord({
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GISSUER",
        }),
      );

      expect(result).toEqual(
        expect.objectContaining({
          type: "claimable.created",
          asset: "USDC:GISSUER",
        }),
      );
    });

    it("routes claimable.created to each claimant watcher (fan-out)", () => {
      const engine = new EventEngine({ network: "testnet" });
      const w1 = engine.subscribe("GCLAIMANT1");
      const w2 = engine.subscribe("GCLAIMANT2");
      const w3 = engine.subscribe("GCLAIMANT3");
      const h1 = vi.fn();
      const h2 = vi.fn();
      const h3 = vi.fn();
      w1.on("claimable.created", h1);
      w2.on("claimable.created", h2);
      w3.on("claimable.created", h3);

      engine.start();
      latestStream().handlers.onmessage(
        makeCreateClaimableRecord({
          claimants: [
            { destination: "GCLAIMANT1", predicate: { unconditional: true } },
            { destination: "GCLAIMANT2", predicate: { unconditional: true } },
          ],
        }),
      );

      expect(h1).toHaveBeenCalledOnce();
      expect(h2).toHaveBeenCalledOnce();
      expect(h3).not.toHaveBeenCalled();
    });

    it("routes claimable.created to the sponsor watcher", () => {
      const engine = new EventEngine({ network: "testnet" });
      const sponsorWatcher = engine.subscribe("GSPONSOR");
      const handler = vi.fn();
      sponsorWatcher.on("claimable.created", handler);

      engine.start();
      latestStream().handlers.onmessage(makeCreateClaimableRecord());

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: "claimable.created", sponsor: "GSPONSOR" }),
      );
    });

    it("does not emit duplicate to sponsor when sponsor is also a claimant", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSPONSOR");
      const handler = vi.fn();
      watcher.on("claimable.created", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeCreateClaimableRecord({
          claimants: [{ destination: "GSPONSOR", predicate: { unconditional: true } }],
        }),
      );

      expect(handler).toHaveBeenCalledOnce();
    });

    it("does not route to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const unrelated = engine.subscribe("GUNRELATED");
      const handler = vi.fn();
      unrelated.on("claimable.created", handler);

      engine.start();
      latestStream().handlers.onmessage(makeCreateClaimableRecord());

      expect(handler).not.toHaveBeenCalled();
    });

    it("drops record and warns when a required string field is missing", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeCreateClaimableRecord({ balance_id: undefined }));

      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] normalize() dropping create_claimable_balance record.",
        expect.objectContaining({ field: "balance_id", record: expect.any(Object) }),
      );
    });

    it("drops record and warns when claimants array is missing", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeCreateClaimableRecord({ claimants: undefined }));

      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] normalize() dropping create_claimable_balance record.",
        expect.objectContaining({ field: "claimants", record: expect.any(Object) }),
      );
    });

    it("drops record when claimants array is empty", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeCreateClaimableRecord({ claimants: [] }));

      expect(result).toBeNull();
    });

    it("emits to the wildcard listener alongside claimable.created", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GCLAIMANT1");
      const specific = vi.fn();
      const wildcard = vi.fn();
      watcher.on("claimable.created", specific);
      watcher.on("*", wildcard);

      engine.start();
      latestStream().handlers.onmessage(makeCreateClaimableRecord());

      expect(specific).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledWith(expect.objectContaining({ type: "claimable.created" }));
    });
  });

  describe("claim_claimable_balance → claimable.claimed", () => {
    function makeClaimClaimableRecord(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        type: "claim_claimable_balance",
        source_account: "GCLAIMANT",
        created_at: "2026-04-28T13:00:00.000Z",
        balance_id: "00000000abc123",
        ...overrides,
      };
    }

    it("normalizes claim_claimable_balance correctly", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeClaimClaimableRecord());

      expect(result).toEqual({
        type: "claimable.claimed",
        claimant: "GCLAIMANT",
        balanceId: "00000000abc123",
        timestamp: "2026-04-28T13:00:00.000Z",
        raw: expect.any(Object),
      });
    });

    it("routes claimable.claimed to the claimant watcher", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GCLAIMANT");
      const handler = vi.fn();
      watcher.on("claimable.claimed", handler);

      engine.start();
      latestStream().handlers.onmessage(makeClaimClaimableRecord());

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "claimable.claimed",
          claimant: "GCLAIMANT",
          balanceId: "00000000abc123",
        }),
      );
    });

    it("does not route to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const unrelated = engine.subscribe("GUNRELATED");
      const handler = vi.fn();
      unrelated.on("claimable.claimed", handler);

      engine.start();
      latestStream().handlers.onmessage(makeClaimClaimableRecord());

      expect(handler).not.toHaveBeenCalled();
    });

    it("drops record and warns when a required field is missing", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const missingFieldCases: Array<[string, Record<string, unknown>]> = [
        ["source_account", makeClaimClaimableRecord({ source_account: undefined })],
        ["created_at", makeClaimClaimableRecord({ created_at: undefined })],
        ["balance_id", makeClaimClaimableRecord({ balance_id: undefined })],
      ];

      for (const [field, record] of missingFieldCases) {
        vi.clearAllMocks();
        const result = normalize(record);
        expect(result).toBeNull();
        expect(log.warn).toHaveBeenCalledWith(
          "[pulse-core] normalize() dropping claim_claimable_balance record.",
          expect.objectContaining({ field, record: expect.any(Object) }),
        );
      }
    });

    it("emits to the wildcard listener alongside claimable.claimed", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GCLAIMANT");
      const specific = vi.fn();
      const wildcard = vi.fn();
      watcher.on("claimable.claimed", specific);
      watcher.on("*", wildcard);

      engine.start();
      latestStream().handlers.onmessage(makeClaimClaimableRecord());

      expect(specific).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledWith(expect.objectContaining({ type: "claimable.claimed" }));
    });
  });

  describe("liquidity_pool_deposit → lp.deposited", () => {
    function makeLPDepositRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        type: "liquidity_pool_deposit",
        source_account: "GSRC",
        created_at: "2026-04-30T10:00:00.000Z",
        liquidity_pool_id: "pool123",
        reserves_deposited: [
          { asset: "XLM", amount: "1000.0000000" },
          { asset: "USDC:GISSUER", amount: "500.0000000" },
        ],
        shares_received: "700.0000000",
        ...overrides,
      };
    }

    it("normalizes liquidity_pool_deposit correctly", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeLPDepositRecord());

      expect(result).toEqual({
        type: "lp.deposited",
        source: "GSRC",
        pool_id: "pool123",
        reserves_deposited: [
          { asset: "XLM", amount: "1000.0000000" },
          { asset: "USDC:GISSUER", amount: "500.0000000" },
        ],
        shares_received: "700.0000000",
        timestamp: "2026-04-30T10:00:00.000Z",
        raw: expect.any(Object),
      });
    });

    it("routes lp.deposited to the source watcher and wildcard", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const specific = vi.fn();
      const wildcard = vi.fn();
      watcher.on("lp.deposited", specific);
      watcher.on("*", wildcard);

      engine.start();
      latestStream().handlers.onmessage(makeLPDepositRecord());

      expect(specific).toHaveBeenCalledOnce();
      expect(specific).toHaveBeenCalledWith(
        expect.objectContaining({ type: "lp.deposited", source: "GSRC", pool_id: "pool123" }),
      );
      expect(wildcard).toHaveBeenCalledOnce();
    });

    it("does not route to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const unrelated = engine.subscribe("GUNRELATED");
      const handler = vi.fn();
      unrelated.on("lp.deposited", handler);

      engine.start();
      latestStream().handlers.onmessage(makeLPDepositRecord());

      expect(handler).not.toHaveBeenCalled();
    });

    it("drops record and warns when a required field is missing", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeLPDepositRecord({ liquidity_pool_id: undefined }));

      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] normalize() dropping liquidity_pool_deposit record.",
        expect.objectContaining({ field: "liquidity_pool_id", record: expect.any(Object) }),
      );
    });

    it("drops record and warns when reserves_deposited is not an array", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeLPDepositRecord({ reserves_deposited: "invalid" }));

      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] normalize() dropping liquidity_pool_deposit record.",
        expect.objectContaining({ field: "reserves_deposited", record: expect.any(Object) }),
      );
    });
  });

  describe("liquidity_pool_withdraw → lp.withdrawn", () => {
    function makeLPWithdrawRecord(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        type: "liquidity_pool_withdraw",
        source_account: "GSRC",
        created_at: "2026-04-30T11:00:00.000Z",
        liquidity_pool_id: "pool123",
        reserves_received: [
          { asset: "XLM", amount: "900.0000000" },
          { asset: "USDC:GISSUER", amount: "450.0000000" },
        ],
        shares: "600.0000000",
        ...overrides,
      };
    }

    it("normalizes liquidity_pool_withdraw correctly", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeLPWithdrawRecord());

      expect(result).toEqual({
        type: "lp.withdrawn",
        source: "GSRC",
        pool_id: "pool123",
        reserves_received: [
          { asset: "XLM", amount: "900.0000000" },
          { asset: "USDC:GISSUER", amount: "450.0000000" },
        ],
        shares_redeemed: "600.0000000",
        timestamp: "2026-04-30T11:00:00.000Z",
        raw: expect.any(Object),
      });
    });

    it("routes lp.withdrawn to the source watcher and wildcard", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const specific = vi.fn();
      const wildcard = vi.fn();
      watcher.on("lp.withdrawn", specific);
      watcher.on("*", wildcard);

      engine.start();
      latestStream().handlers.onmessage(makeLPWithdrawRecord());

      expect(specific).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledOnce();
    });

    it("drops record and warns when shares field is missing", () => {
      const engine = new EventEngine({ network: "testnet", logger: log });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeLPWithdrawRecord({ shares: undefined }));

      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalledWith(
        "[pulse-core] normalize() dropping liquidity_pool_withdraw record.",
        expect.objectContaining({ field: "shares", record: expect.any(Object) }),
      );
    });
  });

  describe("allow_trust → trustline.authorized / trustline.deauthorized", () => {
    function makeAllowTrustRecord(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        type: "allow_trust",
        source_account: "GISSUER",
        trustor: "GTRUSTEE",
        trustee: "GISSUER",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GISSUER",
        authorize: true,
        created_at: "2026-05-01T10:00:00.000Z",
        ...overrides,
      };
    }

    it("normalizes allow_trust as trustline.authorized when authorize is true", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeAllowTrustRecord());

      expect(result).toEqual({
        type: "trustline.authorized",
        trustor: "GTRUSTEE",
        issuer: "GISSUER",
        asset: "USDC:GISSUER",
        timestamp: "2026-05-01T10:00:00.000Z",
        operation: "allow_trust",
        raw: expect.any(Object),
      });
    });

    it("normalizes allow_trust as trustline.deauthorized when authorize is false", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeAllowTrustRecord({ authorize: false }));

      expect(result).toEqual(expect.objectContaining({ type: "trustline.deauthorized" }));
    });

    it("routes trustline.authorized to both issuer and trustor watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const issuerW = engine.subscribe("GISSUER");
      const trustorW = engine.subscribe("GTRUSTEE");
      const issuerH = vi.fn();
      const trustorH = vi.fn();
      issuerW.on("trustline.authorized", issuerH);
      trustorW.on("trustline.authorized", trustorH);

      engine.start();
      latestStream().handlers.onmessage(makeAllowTrustRecord());

      expect(issuerH).toHaveBeenCalledOnce();
      expect(trustorH).toHaveBeenCalledOnce();
    });

    it("does not route to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const unrelated = engine.subscribe("GUNRELATED");
      const handler = vi.fn();
      unrelated.on("trustline.authorized", handler);

      engine.start();
      latestStream().handlers.onmessage(makeAllowTrustRecord());

      expect(handler).not.toHaveBeenCalled();
    });

    it("drops record when authorize field is not boolean", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeAllowTrustRecord({ authorize: "yes" }));

      expect(result).toBeNull();
    });
  });

  describe("set_trust_line_flags → trustline.authorized / trustline.deauthorized", () => {
    function makeSTLFRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        type: "set_trust_line_flags",
        source_account: "GISSUER",
        trustor: "GTRUSTEE",
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: "GISSUER",
        set_flags_s: ["authorized"],
        clear_flags_s: [],
        created_at: "2026-05-01T11:00:00.000Z",
        ...overrides,
      };
    }

    it("normalizes set_trust_line_flags as trustline.authorized when setting authorized flag", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeSTLFRecord());

      expect(result).toEqual({
        type: "trustline.authorized",
        trustor: "GTRUSTEE",
        issuer: "GISSUER",
        asset: "USDC:GISSUER",
        timestamp: "2026-05-01T11:00:00.000Z",
        operation: "set_trust_line_flags",
        raw: expect.any(Object),
      });
    });

    it("normalizes set_trust_line_flags as trustline.deauthorized when clearing authorized flag", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(makeSTLFRecord({ set_flags_s: [], clear_flags_s: ["authorized"] }));

      expect(result).toEqual(expect.objectContaining({ type: "trustline.deauthorized" }));
    });

    it("returns null when both set and clear include authorized (ambiguous)", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as { normalize(record: unknown): unknown }
      ).normalize.bind(engine);

      const result = normalize(
        makeSTLFRecord({ set_flags_s: ["authorized"], clear_flags_s: ["authorized"] }),
      );

      expect(result).toBeNull();
    });
  });

  it("reports per-source status and preserves flat fields for compatibility", () => {
    const engine = new EventEngine({ network: "testnet" });

    expect(engine.status()).toMatchObject({
      running: false,
      watcherCount: 0,
      contractWatcherCount: 0,
      lastEventAt: null,
      reconnectAttempt: 0,
      pausedSources: undefined,
      sources: {
        horizon: {
          running: false,
          lastEventAt: null,
          reconnectAttempt: 0,
          cursor: undefined,
        },
        soroban: {
          running: false,
          lastEventAt: null,
          reconnectAttempt: 0,
        },
      },
    });

    engine.start();

    expect(engine.status().running).toBe(true);
    expect(engine.status().sources.horizon.running).toBe(true);
    expect(engine.status().sources.soroban.running).toBe(false);

    latestStream().handlers.onmessage({
      type: "payment",
      to: "GABC",
      from: "GSRC",
      amount: "10",
      asset_type: "native",
      created_at: "2026-03-26T20:00:00.000Z",
    });

    expect(engine.status()).toMatchObject({
      lastEventAt: "2026-03-26T20:00:00.000Z",
      sources: {
        horizon: {
          lastEventAt: "2026-03-26T20:00:00.000Z",
        },
      },
    });
  });
});
