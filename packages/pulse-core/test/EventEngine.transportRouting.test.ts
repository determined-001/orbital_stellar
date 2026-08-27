/**
 * EventEngine transport routing (issue 6.12): `CoreConfig.ingestion` actually
 * changing which transport delivers which event family, plus `"auto"`
 * mode's RPC-capability resolution.
 *
 * `resolveFamilyTransport()`'s own routing-matrix test (`resolveFamilyTransport.test.ts`)
 * covers the pure decision function; this file covers the live wiring: does
 * an `EventEngine` actually stop delivering a family via Horizon and start
 * delivering it via the unified transport, and does `"auto"` fall back
 * correctly against a non-P23 RPC.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Address, Keypair, ScInt, xdr } from "@stellar/stellar-sdk";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};
type MockStreamInstance = {
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};
const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();

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

  return { ...actual, Horizon: { ...actual.Horizon, Server: MockServer } };
});

import { EventEngine } from "../src/EventEngine.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";

function latestStream(): MockStreamInstance {
  const stream = streamInstances.at(-1);
  if (!stream) throw new Error("Expected an active mock stream.");
  return stream;
}

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

function sym(name: string): string {
  return xdr.ScVal.scvSymbol(name).toXDR("base64");
}
function addrTopic(g: string): string {
  return new Address(g).toScVal().toXDR("base64");
}
function assetTopic(codeIssuer: string): string {
  return xdr.ScVal.scvString(codeIssuer).toXDR("base64");
}
function i128Value(n: bigint): string {
  return new ScInt(n).toI128().toXDR("base64");
}
function boolValue(b: boolean): string {
  return xdr.ScVal.scvBool(b).toXDR("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Mirrors `EventEngine.unifiedTransport.test.ts`'s fetch-routing-by-JSON-RPC-method mock. */
function makeFetch(getEventsResult: () => unknown, protocolVersion: number | undefined = 23) {
  return vi.fn(async (_url: unknown, init: RequestInit) => {
    let method: string | undefined;
    try {
      method = (JSON.parse(init.body as string) as { method?: string }).method;
    } catch {
      return new Response("", { status: 200 });
    }
    if (method === "getNetwork") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: {
          passphrase: TESTNET_PASSPHRASE,
          ...(protocolVersion !== undefined ? { protocolVersion } : {}),
        },
      });
    }
    if (method === "getEvents") {
      return jsonResponse({ jsonrpc: "2.0", id: 1, result: getEventsResult() });
    }
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: { sequence: 100, events: [] } });
  }) as unknown as typeof fetch;
}

const PAYMENT_RECORD = {
  type: "payment",
  to: "GDEST",
  from: "GSRC",
  amount: "100",
  asset_type: "native",
  created_at: "2026-03-26T20:00:00.000Z",
};

function makeOfferRecord(): Record<string, unknown> {
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
    price_r: { n: 1, d: 2 },
    created_at: "2026-04-28T14:00:00.000Z",
  };
}

describe("EventEngine transport routing", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    SorobanRpcClient.setCachedNetwork(null);
    vi.useRealTimers();
    streamInstances.length = 0;
  });

  describe("effectiveIngestion resolution", () => {
    it("stays horizon by default, even with a unified transport configured", () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
      globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }));

      const engine = new EventEngine({
        network: "testnet",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      engine.start();

      expect(engine.status().effectiveIngestion).toBe("horizon");
    });

    it('resolves to unified for ingestion: "unified" with a unified transport configured', () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
      globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }));

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      engine.start();

      expect(engine.status().effectiveIngestion).toBe("unified");
    });

    it('falls back to horizon for ingestion: "unified" with no unified transport configured', () => {
      const engine = new EventEngine({ network: "testnet", ingestion: "unified" });
      engine.start();

      expect(engine.status().effectiveIngestion).toBe("horizon");
    });

    it('resolves "auto" to unified when the probed RPC reports CAP-67 support (protocol >= 23)', () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
      globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }), 23);

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "auto",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      engine.start();

      expect(engine.status().effectiveIngestion).toBe("unified");
    });

    it('falls back "auto" to horizon against a mocked non-P23 RPC', () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 22 });
      globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }), 22);

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "auto",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      engine.start();

      expect(engine.status().effectiveIngestion).toBe("horizon");
    });

    it('falls back "auto" to horizon when the RPC reports no protocol version at all', () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE });
      globalThis.fetch = makeFetch(
        () => ({ events: [], cursor: "0001", latestLedger: 100 }),
        undefined,
      );

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "auto",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      engine.start();

      expect(engine.status().effectiveIngestion).toBe("horizon");
    });
  });

  describe("Horizon-side suppression", () => {
    it("delivers payment (a unified-equivalent family) via Horizon in the default horizon mode", () => {
      const engine = new EventEngine({ network: "testnet" });
      const watcher = engine.subscribe("GDEST");
      const handler = vi.fn();
      watcher.on("payment.received", handler);

      engine.start();
      latestStream().handlers.onmessage(PAYMENT_RECORD);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("suppresses payment from Horizon once ingestion is unified and a unified transport is configured", () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
      globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }));

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      const watcher = engine.subscribe("GDEST");
      const handler = vi.fn();
      watcher.on("payment.received", handler);
      watcher.on("*", handler);

      engine.start();
      latestStream().handlers.onmessage(PAYMENT_RECORD);

      expect(handler).not.toHaveBeenCalled();
    });

    it("never suppresses a Horizon-only family (offer) regardless of ingestion mode", () => {
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
      globalThis.fetch = makeFetch(() => ({ events: [], cursor: "0001", latestLedger: 100 }));

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      const watcher = engine.subscribe("GSRC");
      const handler = vi.fn();
      watcher.on("offer.created", handler);

      engine.start();
      latestStream().handlers.onmessage(makeOfferRecord());

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe("unified-side dispatch", () => {
    it("decodes and dispatches a CAP-67 transfer event to both sender and recipient watchers", async () => {
      vi.useFakeTimers();
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });

      const from = Keypair.random().publicKey();
      const to = Keypair.random().publicKey();
      let served = false;
      globalThis.fetch = makeFetch(() => {
        if (served) return { events: [], cursor: "0002", latestLedger: 100 };
        served = true;
        return {
          events: [
            {
              id: "0001",
              pagingToken: "0001",
              type: "contract",
              ledger: 100,
              ledgerClosedAt: "2026-08-01T00:00:00Z",
              contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
              topic: [sym("transfer"), addrTopic(from), addrTopic(to), assetTopic("native")],
              value: i128Value(10_000_000n),
            },
          ],
          cursor: "0001",
          latestLedger: 100,
        };
      });

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      const fromWatcher = engine.subscribe(from);
      const toWatcher = engine.subscribe(to);
      const sentHandler = vi.fn();
      const receivedHandler = vi.fn();
      fromWatcher.on("payment.sent", sentHandler);
      toWatcher.on("payment.received", receivedHandler);

      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(sentHandler).toHaveBeenCalledTimes(1);
      expect(receivedHandler).toHaveBeenCalledTimes(1);
      expect(sentHandler.mock.calls[0]?.[0]).toMatchObject({ asset: "XLM", amount: "1.0000000" });

      await engine.stop();
    });

    it("decodes and dispatches a CAP-67 mint event as payment.received", async () => {
      vi.useFakeTimers();
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });

      const to = Keypair.random().publicKey();
      const issuer = Keypair.random().publicKey();
      let served = false;
      globalThis.fetch = makeFetch(() => {
        if (served) return { events: [], cursor: "0002", latestLedger: 100 };
        served = true;
        return {
          events: [
            {
              id: "0001",
              pagingToken: "0001",
              type: "contract",
              ledger: 100,
              ledgerClosedAt: "2026-08-01T00:00:00Z",
              contractId: "CCONTRACT",
              topic: [sym("mint"), addrTopic(to), assetTopic(`TEST:${issuer}`)],
              value: i128Value(5_000_000n),
            },
          ],
          cursor: "0001",
          latestLedger: 100,
        };
      });

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      const toWatcher = engine.subscribe(to);
      const receivedHandler = vi.fn();
      toWatcher.on("payment.received", receivedHandler);

      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(receivedHandler).toHaveBeenCalledTimes(1);
      expect(receivedHandler.mock.calls[0]?.[0]).toMatchObject({
        asset: `TEST:${issuer}`,
        amount: "0.5000000",
      });

      await engine.stop();
    });

    it("decodes and dispatches a CAP-67 set_authorized event as trustline.authorized", async () => {
      vi.useFakeTimers();
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });

      const trustor = Keypair.random().publicKey();
      const issuer = Keypair.random().publicKey();
      let served = false;
      globalThis.fetch = makeFetch(() => {
        if (served) return { events: [], cursor: "0002", latestLedger: 100 };
        served = true;
        return {
          events: [
            {
              id: "0001",
              pagingToken: "0001",
              type: "contract",
              ledger: 100,
              ledgerClosedAt: "2026-08-01T00:00:00Z",
              contractId: "CCONTRACT",
              topic: [sym("set_authorized"), addrTopic(trustor), assetTopic(`TEST:${issuer}`)],
              value: boolValue(true),
            },
          ],
          cursor: "0001",
          latestLedger: 100,
        };
      });

      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      const trustorWatcher = engine.subscribe(trustor);
      const authHandler = vi.fn();
      trustorWatcher.on("trustline.authorized", authHandler);

      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(authHandler).toHaveBeenCalledTimes(1);
      expect(authHandler.mock.calls[0]?.[0]).toMatchObject({
        type: "trustline.authorized",
        trustor,
        issuer,
        asset: `TEST:${issuer}`,
        operation: "set_authorized",
      });

      await engine.stop();
    });

    it("does not dispatch unified events to watchers while ingestion stays horizon (default)", async () => {
      vi.useFakeTimers();
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });

      const from = Keypair.random().publicKey();
      const to = Keypair.random().publicKey();
      let served = false;
      globalThis.fetch = makeFetch(() => {
        if (served) return { events: [], cursor: "0002", latestLedger: 100 };
        served = true;
        return {
          events: [
            {
              id: "0001",
              pagingToken: "0001",
              type: "contract",
              ledger: 100,
              ledgerClosedAt: "2026-08-01T00:00:00Z",
              contractId: "CCONTRACT",
              topic: [sym("transfer"), addrTopic(from), addrTopic(to), assetTopic("native")],
              value: i128Value(10_000_000n),
            },
          ],
          cursor: "0001",
          latestLedger: 100,
        };
      });

      // unifiedEvents is on, but ingestion defaults to "horizon" - zero
      // behavior change, per CoreConfig.ingestion's doc.
      const engine = new EventEngine({
        network: "testnet",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
      });
      const toWatcher = engine.subscribe(to);
      const handler = vi.fn();
      toWatcher.on("payment.received", handler);
      toWatcher.on("*", handler);

      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(handler).not.toHaveBeenCalled();
      expect(engine.status().sources.unified.lastEventAt).not.toBeNull();

      await engine.stop();
    });

    it("logs a warning for a unified event whose topic[0] isn't a decodable symbol", async () => {
      vi.useFakeTimers();
      SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });

      let served = false;
      globalThis.fetch = makeFetch(() => {
        if (served) return { events: [], cursor: "0002", latestLedger: 100 };
        served = true;
        return {
          events: [
            {
              id: "0001",
              pagingToken: "0001",
              type: "contract",
              ledger: 100,
              ledgerClosedAt: "2026-08-01T00:00:00Z",
              contractId: "CCONTRACT",
              topic: ["not-valid-base64-xdr"],
              value: i128Value(1n),
            },
          ],
          cursor: "0001",
          latestLedger: 100,
        };
      });

      const warn = vi.fn();
      const engine = new EventEngine({
        network: "testnet",
        ingestion: "unified",
        soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
        logger: { info: vi.fn(), warn, error: vi.fn() },
      });

      engine.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("isn't a decodable symbol"),
        expect.objectContaining({ eventId: "0001" }),
      );

      await engine.stop();
    });
  });
});
