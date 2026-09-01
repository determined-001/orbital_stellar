/**
 * EventEngine dedupe window wiring (issue 6.13): during a routing transition
 * (mode switch, `"auto"` fallback recovery) both transports can briefly
 * observe the same on-chain movement. `dedupe.ts`'s `DedupeWindow` /
 * `deriveDedupeKey` primitive is covered in isolation by `dedupe.test.ts`;
 * this file covers the live wiring - does an `EventEngine` actually suppress
 * a second delivery of the same movement once one transport has already
 * delivered it, and does the wired window stay bounded rather than growing
 * unboundedly with every distinct movement it ever sees.
 *
 * `effectiveIngestion` is forced directly (a private field) between
 * deliveries rather than trying to reproduce the exact narrow production
 * race with timers: the dedupe window's job is to suppress a repeat key
 * regardless of which transport attached it or when, so exercising both
 * attachment paths against the same key is the right level to test at.
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch() {
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
        result: { passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 },
      });
    }
    return jsonResponse({ jsonrpc: "2.0", id: 1, result: { sequence: 100, events: [] } });
  }) as unknown as typeof fetch;
}

/** A Horizon `payment` record carrying the (txHash, id) pair the matching unified event shares. */
function horizonPaymentRecord(txHash: string, opId: string, to: string, from: string) {
  return {
    type: "payment",
    id: opId,
    transaction_hash: txHash,
    to,
    from,
    amount: "100",
    asset_type: "native",
    created_at: "2026-03-26T20:00:00.000Z",
  };
}

/**
 * A CAP-67 unified transfer event whose `id` shares `opId` as its TOID prefix.
 *
 * `eventIndex` is the `-<n>` suffix Soroban RPC appends to distinguish several
 * events emitted by the *same* operation. It defaults to 0 because most tests
 * here only need one event per operation; the co-operation tests vary it.
 */
function unifiedTransferEvent(
  txHash: string,
  opId: string,
  from: string,
  to: string,
  eventIndex = 0,
) {
  const id = `${opId}-${String(eventIndex).padStart(10, "0")}`;
  return {
    id,
    pagingToken: id,
    type: "contract",
    ledger: 100,
    ledgerClosedAt: "2026-08-01T00:00:00Z",
    contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    txHash,
    topic: [sym("transfer"), addrTopic(from), addrTopic(to), assetTopic("native")],
    value: i128Value(10_000_000n),
  };
}

describe("EventEngine dedupe window wiring", () => {
  afterEach(() => {
    SorobanRpcClient.setCachedNetwork(null);
    streamInstances.length = 0;
  });

  it("delivers the same on-chain movement exactly once when observed via both transports", async () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
    globalThis.fetch = makeFetch();

    const to = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();
    const txHash = "a".repeat(64);
    const opId = "6854235736408065";

    const engine = new EventEngine({
      network: "testnet",
      ingestion: "unified",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });
    const watcher = engine.subscribe(to);
    const received = vi.fn();
    watcher.on("payment.received", received);

    engine.start();

    // effectiveIngestion resolves to "unified" for this cached-network setup,
    // so the unified path is what dispatches first here.
    expect(engine.status().effectiveIngestion).toBe("unified");
    (engine as any).dispatchUnifiedEvent(unifiedTransferEvent(txHash, opId, from, to));
    expect(received).toHaveBeenCalledTimes(1);

    // Force effectiveIngestion back to "horizon" so the matching Horizon
    // record isn't suppressed by transport routing before it ever reaches
    // the dedupe check - this test is about the dedupe window itself, not
    // 6.12's routing suppression, which is covered separately.
    (engine as any).effectiveIngestion = "horizon";
    latestStream().handlers.onmessage(horizonPaymentRecord(txHash, opId, to, from));

    // The dedupe window - not routing suppression - is what stops this
    // second delivery of the same (txHash, opId) movement.
    expect(received).toHaveBeenCalledTimes(1);

    await engine.stop();
  });

  it("does not suppress two distinct movements that happen to share a transport", async () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
    globalThis.fetch = makeFetch();

    const to = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();

    const engine = new EventEngine({
      network: "testnet",
      ingestion: "unified",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });
    const watcher = engine.subscribe(to);
    const received = vi.fn();
    watcher.on("payment.received", received);

    engine.start();

    (engine as any).dispatchUnifiedEvent(
      unifiedTransferEvent("a".repeat(64), "1000000000000001", from, to),
    );
    (engine as any).dispatchUnifiedEvent(
      unifiedTransferEvent("b".repeat(64), "1000000000000002", from, to),
    );

    expect(received).toHaveBeenCalledTimes(2);

    await engine.stop();
  });

  it("delivers two payment operations in the same transaction at a realistic pubnet ledger height", async () => {
    // Regression for a real bug: deriveHorizonDedupeRef used to round-trip
    // the operation TOID through `Number`, which loses precision past ledger
    // ~2,097,152 - both testnet and pubnet are long past that. At today's
    // pubnet height (~64.18M), two operations in one transaction collapse
    // onto the identical `Number()`-derived index, so the second was
    // silently dropped as a false-positive duplicate - exactly the shape of
    // a batched payout. `BigInt(id).toString()` keeps them distinct.
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
    globalThis.fetch = makeFetch();

    const to = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();
    const txHash = "e".repeat(64);
    const ledger = 64_182_674n;
    const txOrder = 7n;
    const opId0 = (ledger * 2n ** 32n + txOrder * 2n ** 12n + 0n).toString();
    const opId1 = (ledger * 2n ** 32n + txOrder * 2n ** 12n + 1n).toString();

    // Sanity check on the fixture itself: both TOIDs really do collapse to
    // the same value under Number(), which is exactly what made the bug
    // invisible to a naive review of the diff.
    expect(Number(opId0)).toBe(Number(opId1));

    const engine = new EventEngine({ network: "testnet" });
    const watcher = engine.subscribe(to);
    const received = vi.fn();
    watcher.on("payment.received", received);

    engine.start();

    latestStream().handlers.onmessage(horizonPaymentRecord(txHash, opId0, to, from));
    latestStream().handlers.onmessage(horizonPaymentRecord(txHash, opId1, to, from));

    expect(received).toHaveBeenCalledTimes(2);

    await engine.stop();
  });

  it("delivers every unified event emitted by one operation, not just the first", async () => {
    // Regression: a dedupe key is operation-granular - deriveUnifiedDedupeRef
    // takes only the TOID prefix of the event `id`, dropping the `-<n>` event
    // index - because the operation is the only granularity Horizon and the
    // unified stream both express. One operation routinely emits several
    // unified events though (a multi-hop path payment emits a `transfer` per
    // hop), and those all share a key. Suppressing them as duplicates would
    // silently drop legitimate distinct movements.
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
    globalThis.fetch = makeFetch();

    const to = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();
    const txHash = "f".repeat(64);
    const opId = "6854235736408066";

    const engine = new EventEngine({
      network: "testnet",
      ingestion: "unified",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });
    const watcher = engine.subscribe(to);
    const received = vi.fn();
    watcher.on("payment.received", received);

    engine.start();

    // Three events, one operation: same txHash, same TOID, event index 0/1/2.
    for (const eventIndex of [0, 1, 2]) {
      (engine as any).dispatchUnifiedEvent(
        unifiedTransferEvent(txHash, opId, from, to, eventIndex),
      );
    }

    expect(received).toHaveBeenCalledTimes(3);

    await engine.stop();
  });

  it("suppresses exactly one cross-transport duplicate however many events the operation emitted", async () => {
    // The counting property that makes operation-granular keys safe: for an
    // operation seen as N events on one transport and 1 record on the other,
    // exactly one arrival is suppressed, so the watcher sees N either way.
    // This covers the Horizon-first ordering - the unified-first ordering is
    // the reverse of the same rule.
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
    globalThis.fetch = makeFetch();

    const to = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();
    const txHash = "9".repeat(64);
    const opId = "6854235736408067";

    const engine = new EventEngine({
      network: "testnet",
      ingestion: "unified",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });
    const watcher = engine.subscribe(to);
    const received = vi.fn();
    watcher.on("payment.received", received);

    engine.start();

    // Horizon observes the operation first (one record).
    (engine as any).effectiveIngestion = "horizon";
    latestStream().handlers.onmessage(horizonPaymentRecord(txHash, opId, to, from));
    expect(received).toHaveBeenCalledTimes(1);

    // The unified stream then replays the same operation as three events.
    // The first is the genuine duplicate of the Horizon record and is
    // suppressed; the other two are distinct movements and are delivered.
    (engine as any).effectiveIngestion = "unified";
    for (const eventIndex of [0, 1, 2]) {
      (engine as any).dispatchUnifiedEvent(
        unifiedTransferEvent(txHash, opId, from, to, eventIndex),
      );
    }

    expect(received).toHaveBeenCalledTimes(3);

    await engine.stop();
  });

  it("the wired window is bounded - an evicted key no longer suppresses a repeat", async () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: TESTNET_PASSPHRASE, protocolVersion: 23 });
    globalThis.fetch = makeFetch();

    const to = Keypair.random().publicKey();
    const from = Keypair.random().publicKey();
    const firstTxHash = "c".repeat(64);
    const firstOpId = "2000000000000000";

    const engine = new EventEngine({
      network: "testnet",
      ingestion: "unified",
      soroban: { rpcUrl: "https://fake-rpc.example", unifiedEvents: true },
    });
    const watcher = engine.subscribe(to);
    const received = vi.fn();
    watcher.on("payment.received", received);

    engine.start();

    // Read the wired window's own capacity rather than hardcoding it, so
    // this test tracks whatever the engine is actually configured with.
    const capacity = (engine as any).dedupeWindow.capacity as number;

    (engine as any).dispatchUnifiedEvent(unifiedTransferEvent(firstTxHash, firstOpId, from, to));
    expect(received).toHaveBeenCalledTimes(1);

    // Evict the first key by pushing `capacity` more distinct movements
    // through - a bare LRU window has room for exactly `capacity` keys, so
    // this exactly fills it past the first entry.
    for (let i = 0; i < capacity; i++) {
      (engine as any).dispatchUnifiedEvent(
        unifiedTransferEvent(`d${i}`.padEnd(64, "0"), `3${String(i).padStart(15, "0")}`, from, to),
      );
    }

    // The first movement's key has been evicted - replaying it must be
    // treated as a new movement, not suppressed as a stale duplicate.
    (engine as any).dispatchUnifiedEvent(unifiedTransferEvent(firstTxHash, firstOpId, from, to));
    expect(received).toHaveBeenCalledTimes(capacity + 2);

    await engine.stop();
  });
});
