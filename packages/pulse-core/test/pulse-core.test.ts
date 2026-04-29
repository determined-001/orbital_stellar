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
    constructor(_url: string) { }

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

function latestStream(): MockStreamInstance {
  const stream = streamInstances.at(-1);
  if (!stream) {
    throw new Error("Expected an active mock stream.");
  }

  return stream;
}

describe("pulse-core EventEngine", () => {
  beforeEach(() => {
    streamInstances.length = 0;
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
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

    const registry = (engine as unknown as { registry: Map<string, unknown> })
      .registry;
    expect(registry.size).toBe(2);

    engine.stop();

    expect(registry.size).toBe(0);
  });

  it("returns null and warns when a required payment field is missing", () => {
    const engine = new EventEngine({ network: "testnet" });
    const normalize = (
      engine as unknown as {
        normalize(record: unknown): unknown;
      }
    ).normalize.bind(engine);

    // Missing `to`
    const result = normalize({
      type: "payment",
      from: "GSRC",
      amount: "42",
      asset_type: "native",
      created_at: "2026-03-26T20:00:00.000Z",
    });

    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[pulse-core] normalize() dropping payment record: field "to" is missing or not a non-empty string.',
      expect.objectContaining({ record: expect.any(Object) })
    );
  });

  it("returns null and warns for each missing required field individually", () => {
    const engine = new EventEngine({ network: "testnet" });
    const normalize = (
      engine as unknown as {
        normalize(record: unknown): unknown;
      }
    ).normalize.bind(engine);

    const missingFieldCases: Array<[string, Record<string, unknown>]> = [
      ["from", { type: "payment", to: "GDEST", amount: "1", created_at: "2026-01-01T00:00:00Z" }],
      ["amount", { type: "payment", to: "GDEST", from: "GSRC", created_at: "2026-01-01T00:00:00Z" }],
      ["created_at", { type: "payment", to: "GDEST", from: "GSRC", amount: "1" }],
    ];

    for (const [field, record] of missingFieldCases) {
      vi.clearAllMocks();
      const result = normalize(record);
      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        `[pulse-core] normalize() dropping payment record: field "${field}" is missing or not a non-empty string.`,
        expect.objectContaining({ record: expect.any(Object) })
      );
    }
  });

  it("removes stopped watchers from the registry and keeps stop idempotent", () => {
    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe("GABC");

    expect(
      (engine as unknown as { registry: Map<string, unknown> }).registry.has("GABC")
    ).toBe(true);

    watcher.stop();
    watcher.stop();

    expect(
      (engine as unknown as { registry: Map<string, unknown> }).registry.has("GABC")
    ).toBe(false);
    expect(engine.subscribe("GABC")).not.toBe(watcher);
  });

  it("guards start() so duplicate live streams are not opened", () => {
    const engine = new EventEngine({ network: "testnet" });

    engine.start();
    engine.start();

    expect(streamInstances).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(
      "[pulse-core] EventEngine.start() called while the SSE stream is already active."
    );
  });

  it("reconnects with exponential backoff and emits watcher notifications", () => {
    const engine = new EventEngine({
      network: "testnet",
      reconnect: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
      },
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
        delayMs: 1000,
      })
    );
    expect(console.warn).toHaveBeenCalledWith(
      "[pulse-core] SSE reconnect attempt 1 scheduled in 1000ms."
    );
    expect(streamInstances).toHaveLength(1);

    vi.advanceTimersByTime(1000);

    expect(streamInstances).toHaveLength(2);

    latestStream().handlers.onerror(new Error("stream dropped again"));

    expect(streamInstances[1]?.close).toHaveBeenCalledTimes(1);
    expect(reconnecting).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "engine.reconnecting",
        attempt: 2,
        delayMs: 2000,
      })
    );
    expect(console.warn).toHaveBeenLastCalledWith(
      "[pulse-core] SSE reconnect attempt 2 scheduled in 2000ms."
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
      })
    );
    expect(console.info).toHaveBeenCalledWith(
      "[pulse-core] SSE reconnect succeeded on attempt 2."
    );

    latestStream().handlers.onerror(new Error("stream dropped after recovery"));

    expect(reconnecting).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "engine.reconnecting",
        attempt: 1,
        delayMs: 1000,
      })
    );
  });

  describe("set_options → account.options_changed", () => {
    function makeSetOptionsRecord(
      overrides: Record<string, unknown>
    ): Record<string, unknown> {
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
        makeSetOptionsRecord({ signer_key: "GNEWSIGNER", signer_weight: 2 })
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.options_changed",
          source: "GSRC",
          changes: { signer_added: { key: "GNEWSIGNER", weight: 2 } },
          timestamp: "2026-04-24T10:00:00.000Z",
        })
      );
    });

    it("emits account.options_changed with signer_removed when signer_weight is 0", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ signer_key: "GOLDSIGNER", signer_weight: 0 })
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.options_changed",
          source: "GSRC",
          changes: { signer_removed: { key: "GOLDSIGNER", weight: 0 } },
        })
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
        })
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.options_changed",
          source: "GSRC",
          changes: {
            thresholds: {
              low_threshold: 1,
              med_threshold: 2,
              high_threshold: 3,
              master_key_weight: 1,
            },
          },
        })
      );
    });

    it("emits account.options_changed with home_domain when home_domain is present", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ home_domain: "example.com" })
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "account.options_changed",
          source: "GSRC",
          changes: { home_domain: "example.com" },
        })
      );
    });

    it("only includes fields that are actually present in changes", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("account.options_changed", handler);

      engine.start();
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ home_domain: "stellar.org", low_threshold: 5 })
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
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ set_flags: 1 })
      );

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
      latestStream().handlers.onmessage(
        makeSetOptionsRecord({ home_domain: "example.com" })
      );

      expect(srcHandler).toHaveBeenCalledOnce();
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("liquidity_pool_deposit → lp.deposited", () => {
    function makeLiquidityPoolDepositRecord(
      overrides: Record<string, unknown>
    ): Record<string, unknown> {
      return {
        type: "liquidity_pool_deposit",
        source_account: "GSRC",
        liquidity_pool_id: "abcdef123456",
        reserves_deposited: [
          { asset: "JPY:GBVAOIACNSB7OVUXJYC5UE2D4YK2F7A24T7EE5YOMN4CE6GCHUTOUQXM", amount: "983.0000005" },
          { asset: "EURT:GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S", amount: "2378.0000005" },
        ],
        shares_received: "1000",
        created_at: "2026-04-24T10:00:00.000Z",
        ...overrides,
      };
    }

    it("emits lp.deposited with pool_id, reserves_deposited, and shares_received", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("lp.deposited", handler);

      engine.start();
      latestStream().handlers.onmessage(makeLiquidityPoolDepositRecord({}));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "lp.deposited",
          source: "GSRC",
          pool_id: "abcdef123456",
          reserves_deposited: [
            { asset: "JPY:GBVAOIACNSB7OVUXJYC5UE2D4YK2F7A24T7EE5YOMN4CE6GCHUTOUQXM", amount: "983.0000005" },
            { asset: "EURT:GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S", amount: "2378.0000005" },
          ],
          shares_received: "1000",
          timestamp: "2026-04-24T10:00:00.000Z",
        })
      );
    });

    it("returns null and warns when liquidity_pool_id is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolDepositRecord({ liquidity_pool_id: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_deposit record: field "liquidity_pool_id" is missing.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("returns null and warns when reserves_deposited is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolDepositRecord({ reserves_deposited: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_deposit record: field "reserves_deposited" is missing.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("returns null and warns when reserves_deposited is not an array", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolDepositRecord({ reserves_deposited: "not an array" })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_deposit record: reserves_deposited is not an array.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("returns null and warns when shares_received is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolDepositRecord({ shares_received: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_deposit record: field "shares_received" is missing.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("does not route lp.deposited to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const srcWatcher = engine.subscribe("GSRC");
      const otherWatcher = engine.subscribe("GOTHER");
      const srcHandler = vi.fn();
      const otherHandler = vi.fn();
      srcWatcher.on("lp.deposited", srcHandler);
      otherWatcher.on("lp.deposited", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeLiquidityPoolDepositRecord({}));

      expect(srcHandler).toHaveBeenCalledOnce();
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });

  describe("liquidity_pool_withdraw → lp.withdrawn", () => {
    function makeLiquidityPoolWithdrawRecord(
      overrides: Record<string, unknown>
    ): Record<string, unknown> {
      return {
        type: "liquidity_pool_withdraw",
        source_account: "GSRC",
        liquidity_pool_id: "fedcba654321",
        reserves_received: [
          { asset: "JPY:GBVAOIACNSB7OVUXJYC5UE2D4YK2F7A24T7EE5YOMN4CE6GCHUTOUQXM", amount: "500.0000000" },
          { asset: "EURT:GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S", amount: "1200.0000000" },
        ],
        shares: "500",
        created_at: "2026-04-24T11:00:00.000Z",
        ...overrides,
      };
    }

    it("emits lp.withdrawn with pool_id, reserves_received, and shares_redeemed", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("lp.withdrawn", handler);

      engine.start();
      latestStream().handlers.onmessage(makeLiquidityPoolWithdrawRecord({}));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "lp.withdrawn",
          source: "GSRC",
          pool_id: "fedcba654321",
          reserves_received: [
            { asset: "JPY:GBVAOIACNSB7OVUXJYC5UE2D4YK2F7A24T7EE5YOMN4CE6GCHUTOUQXM", amount: "500.0000000" },
            { asset: "EURT:GAP5LETOV6YIE62YAM56STDANPRDO7ZFDBGSNHJQIYGGKSMOZAHOOS2S", amount: "1200.0000000" },
          ],
          shares_redeemed: "500",
          timestamp: "2026-04-24T11:00:00.000Z",
        })
      );
    });

    it("returns null and warns when liquidity_pool_id is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolWithdrawRecord({ liquidity_pool_id: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_withdraw record: field "liquidity_pool_id" is missing.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("returns null and warns when reserves_received is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolWithdrawRecord({ reserves_received: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_withdraw record: field "reserves_received" is missing.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("returns null and warns when reserves_received is not an array", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolWithdrawRecord({ reserves_received: "not an array" })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_withdraw record: reserves_received is not an array.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("returns null and warns when shares is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeLiquidityPoolWithdrawRecord({ shares: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping liquidity_pool_withdraw record: field "shares" is missing.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("does not route lp.withdrawn to unrelated watchers", () => {
      const engine = new EventEngine({ network: "testnet" });
      const srcWatcher = engine.subscribe("GSRC");
      const otherWatcher = engine.subscribe("GOTHER");
      const srcHandler = vi.fn();
      const otherHandler = vi.fn();
      srcWatcher.on("lp.withdrawn", srcHandler);
      otherWatcher.on("lp.withdrawn", otherHandler);

      engine.start();
      latestStream().handlers.onmessage(makeLiquidityPoolWithdrawRecord({}));

      expect(srcHandler).toHaveBeenCalledOnce();
      expect(otherHandler).not.toHaveBeenCalled();
    });
  });
});
