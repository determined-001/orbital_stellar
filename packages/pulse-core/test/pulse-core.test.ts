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
    constructor(_url: string) {}

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
      ["from",       { type: "payment", to: "GDEST", amount: "1", created_at: "2026-01-01T00:00:00Z" }],
      ["amount",     { type: "payment", to: "GDEST", from: "GSRC", created_at: "2026-01-01T00:00:00Z" }],
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

  describe("create_claimable_balance → claimable.created", () => {
    function makeCreateClaimableRecord(
      overrides: Record<string, unknown> = {}
    ): Record<string, unknown> {
      return {
        type: "create_claimable_balance",
        source_account: "GSPONSOR",
        created_at: "2026-04-28T12:00:00.000Z",
        amount: "100",
        asset_type: "native",
        balance_id: "00000000abc123",
        claimants: [
          { destination: "GCLAIMANT1", predicate: { unconditional: true } },
        ],
        ...overrides,
      };
    }

    it("normalizes create_claimable_balance with native asset", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(makeCreateClaimableRecord());

      expect(result).toEqual({
        type: "claimable.created",
        sponsor: "GSPONSOR",
        balanceId: "00000000abc123",
        claimants: [
          { destination: "GCLAIMANT1", predicate: { unconditional: true } },
        ],
        asset: "XLM",
        amount: "100",
        timestamp: "2026-04-28T12:00:00.000Z",
        raw: expect.any(Object),
      });
    });

    it("normalizes create_claimable_balance with credit asset", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeCreateClaimableRecord({
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GISSUER",
        })
      );

      expect(result).toEqual(
        expect.objectContaining({
          type: "claimable.created",
          asset: "USDC:GISSUER",
        })
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
      // GCLAIMANT3 is subscribed but NOT in the claimants list
      w3.on("claimable.created", h3);

      engine.start();
      latestStream().handlers.onmessage(
        makeCreateClaimableRecord({
          claimants: [
            { destination: "GCLAIMANT1", predicate: { unconditional: true } },
            { destination: "GCLAIMANT2", predicate: { unconditional: true } },
          ],
        })
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
        expect.objectContaining({
          type: "claimable.created",
          sponsor: "GSPONSOR",
        })
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
          claimants: [
            { destination: "GSPONSOR", predicate: { unconditional: true } },
          ],
        })
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
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeCreateClaimableRecord({ balance_id: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping create_claimable_balance record: field "balance_id" is missing or not a non-empty string.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("drops record and warns when claimants array is missing", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
      ).normalize.bind(engine);

      const result = normalize(
        makeCreateClaimableRecord({ claimants: undefined })
      );

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        '[pulse-core] normalize() dropping create_claimable_balance record: field "claimants" is missing or invalid.',
        expect.objectContaining({ record: expect.any(Object) })
      );
    });

    it("drops record when claimants array is empty", () => {
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
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
      expect(wildcard).toHaveBeenCalledWith(
        expect.objectContaining({ type: "claimable.created" })
      );
    });
  });

  describe("claim_claimable_balance → claimable.claimed", () => {
    function makeClaimClaimableRecord(
      overrides: Record<string, unknown> = {}
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
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
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
        })
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
      const engine = new EventEngine({ network: "testnet" });
      const normalize = (
        engine as unknown as {
          normalize(record: unknown): unknown;
        }
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
        expect(console.warn).toHaveBeenCalledWith(
          `[pulse-core] normalize() dropping claim_claimable_balance record: field "${field}" is missing or not a non-empty string.`,
          expect.objectContaining({ record: expect.any(Object) })
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
      expect(wildcard).toHaveBeenCalledWith(
        expect.objectContaining({ type: "claimable.claimed" })
      );
    });
  });
});
