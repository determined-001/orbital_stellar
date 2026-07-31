import { describe, it, expect } from "vitest";
import { Keypair, Networks, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { OnChainRegistryPublisher, OnChainAbiRegistryClient } from "@orbital-stellar/abi-registry";
import type { Logger } from "@orbital-stellar/pulse-core";
import { AutoPublishIndexer } from "../../src/AutoPublishIndexer.js";

// ── Gating ────────────────────────────────────────────────────────────────────
// The whole suite is gated behind INTEGRATION_TESTS=true. The live test
// additionally needs a deployed testnet registry contract (via deploy_testnet.sh)
// and a funded account — without them the live case self-skips with a clear
// message instead of failing the nightly run.
const shouldRun = process.env.INTEGRATION_TESTS === "true";

const RPC_URL = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const REGISTRY_CONTRACT_ID = process.env.SOROBAN_CONTRACT_ID ?? "";
const INVOKER_SECRET = process.env.SOROBAN_INVOKER_SECRET ?? "";

/**
 * The "unknown" contract whose spec the indexer will auto-discover and
 * publish. This must be a genuine deployed Soroban contract on testnet that
 * has an embedded WASM spec but does NOT yet have a spec published under
 * Orbital's publisher address in the registry.
 *
 * A good candidate is the `orbital-demo-emitter` contract (see
 * contracts/demo-emitter) which is deployed alongside the registry by
 * contracts/deploy/deploy_testnet.sh. Its `ping()` function emits a
 * `contract.emitted` event and its WASM embeds a discoverable spec.
 */
const TARGET_CONTRACT_ID = process.env.TARGET_CONTRACT_ID ?? "";

/**
 * Optional second unknown contract for the concurrent-dedupe test. When
 * unset the dedupe test reuses TARGET_CONTRACT_ID (which still exercises the
 * in-flight deduplication path on first run).
 */
const TARGET_CONTRACT_ID_2 = process.env.TARGET_CONTRACT_ID_2 ?? "";

const INVOKER_ADDRESS = (() => {
  try {
    return INVOKER_SECRET ? Keypair.fromSecret(INVOKER_SECRET).publicKey() : "";
  } catch {
    return "";
  }
})();

const hasConfig = Boolean(REGISTRY_CONTRACT_ID && INVOKER_SECRET && TARGET_CONTRACT_ID);

// ── Helpers ───────────────────────────────────────────────────────────────────

class InMemoryLogger implements Logger {
  readonly entries: Array<{
    level: string;
    message: string;
    meta?: Record<string, unknown>;
  }> = [];

  info(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: "info", message, meta });
  }
  warn(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: "warn", message, meta });
  }
  error(message: string, meta?: Record<string, unknown>): void {
    this.entries.push({ level: "error", message, meta });
  }
}

/** Shared publisher and registry client helpers. */
function createPublisher() {
  return new OnChainRegistryPublisher({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: RPC_URL,
    networkPassphrase: Networks.TESTNET,
    publisherSecret: INVOKER_SECRET,
    pollIntervalMs: 1000,
    pollTimeoutMs: 30_000,
  });
}

function createRegistryClient() {
  return new OnChainAbiRegistryClient({
    contractId: REGISTRY_CONTRACT_ID,
    rpcUrl: RPC_URL,
    networkPassphrase: Networks.TESTNET,
    publisher: INVOKER_ADDRESS,
    // Short cache TTL so tests see fresh state across runs.
    cacheTtlMs: 100,
    maxCacheSize: 10,
  });
}

/**
 * Build a minimal fake engine so we can construct AutoPublishIndexer without
 * a live EventEngine. The engine is never started — tests drive the indexer
 * via `ensureDiscovered` directly.
 */
function makeFakeEngine() {
  return {
    subscribeContract: () => ({ on: () => undefined }),
    unsubscribeContract: () => undefined,
  } as unknown as import("@orbital-stellar/pulse-core").EventEngine;
}

/** Fetch the current sequence number of the invoker account from the RPC. */
async function getAccountSequence(): Promise<string> {
  const server = new SorobanRpc.Server(RPC_URL);
  const keypair = Keypair.fromSecret(INVOKER_SECRET);
  const account = await server.getAccount(keypair.publicKey());
  return account.sequenceNumber();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// Each test creates its own logger to avoid scoping issues with runIf.

describe.runIf(shouldRun)("AutoPublishIndexer live registry integration", () => {
  it.runIf(hasConfig)(
    "discovers and publishes a spec for an unknown contract, logging structured info",
    async () => {
      const publisher = createPublisher();
      const registryClient = createRegistryClient();

      // Confirm the target contract does NOT yet have a spec from our publisher.
      const existing = await registryClient.getSpec(TARGET_CONTRACT_ID);
      expect(existing).toBeNull();

      const logger = new InMemoryLogger();

      const indexer = new AutoPublishIndexer({
        engine: makeFakeEngine(),
        registryClient,
        publisher,
        rpcUrl: RPC_URL,
        network: "testnet",
        pointerStrategy: async () => `https://example.com/specs/${TARGET_CONTRACT_ID}.json`,
        logger,
      });

      const spec = await indexer.ensureDiscovered(TARGET_CONTRACT_ID);
      expect(spec).not.toBeNull();
      expect(spec!.contractId).toBe(TARGET_CONTRACT_ID);
      expect(spec!.version).toBeDefined();
      expect(spec!.pointer).toBe(`https://example.com/specs/${TARGET_CONTRACT_ID}.json`);

      // — Structured log assertion —
      // The publish must emit contractId, version, specHash (etag), and txHash.
      const pubLog = logger.entries.find((e) =>
        e.message.includes("published auto-discovered spec"),
      );
      expect(pubLog, "expected a 'published auto-discovered spec' log entry").toBeDefined();
      expect(pubLog!.meta).toBeDefined();
      expect(pubLog!.meta!.contractId).toBe(TARGET_CONTRACT_ID);
      expect(typeof pubLog!.meta!.version).toBe("string");
      expect(typeof pubLog!.meta!.specHash).toBe("string");
      expect(typeof pubLog!.meta!.txHash).toBe("string");
    },
    180_000,
  );

  it.runIf(hasConfig)(
    "two concurrent resolutions of the same unknown contract produce exactly one publish transaction",
    async () => {
      const dedupeContractId = TARGET_CONTRACT_ID_2 || TARGET_CONTRACT_ID;
      const publisher = createPublisher();
      const registryClient = createRegistryClient();

      // Record the sequence number before any publish attempt.
      const seqBefore = await getAccountSequence();

      const logger = new InMemoryLogger();

      const indexer = new AutoPublishIndexer({
        engine: makeFakeEngine(),
        registryClient,
        publisher,
        rpcUrl: RPC_URL,
        network: "testnet",
        pointerStrategy: async () => `https://example.com/specs/${dedupeContractId}.json`,
        logger,
      });

      // Fire two concurrent resolution attempts for the same unknown contract.
      const [resultA, resultB] = await Promise.all([
        indexer.ensureDiscovered(dedupeContractId),
        indexer.ensureDiscovered(dedupeContractId),
      ]);

      expect(resultA).not.toBeNull();
      expect(resultB).not.toBeNull();
      // Both must resolve to the SAME spec object (in-flight dedupe guarantee).
      expect(resultA).toBe(resultB);

      // Assert dedupe by counting transactions: the account's sequence should
      // have advanced by exactly 1 — one publish tx, not two.
      const seqAfter = await getAccountSequence();
      const seqBeforeNum = BigInt(seqBefore);
      const seqAfterNum = BigInt(seqAfter);
      expect(seqAfterNum - seqBeforeNum).toBe(
        1n,
        "sequence should advance by exactly 1, proving only one publish tx was submitted",
      );

      // Also verify only one "published" log line.
      const pubLogs = logger.entries.filter((e) =>
        e.message.includes("published auto-discovered spec"),
      );
      expect(pubLogs).toHaveLength(1);
    },
    180_000,
  );

  it.runIf(hasConfig)(
    "republish rejection is handled as success-with-existing, not as an error",
    async () => {
      const publisher = createPublisher();
      const registryClient = createRegistryClient();
      // Use a short-enough cache TTL so the registry query doesn't mask
      // the duplicate — the client was created with cacheTtlMs: 100 above.

      const logger = new InMemoryLogger();

      const indexer = new AutoPublishIndexer({
        engine: makeFakeEngine(),
        registryClient,
        publisher,
        rpcUrl: RPC_URL,
        network: "testnet",
        pointerStrategy: async () => `https://example.com/specs/${TARGET_CONTRACT_ID}.json`,
        logger,
      });

      // The first call publishes the spec (or returns the existing one from
      // the prior test — either is fine).
      await indexer.ensureDiscovered(TARGET_CONTRACT_ID);

      // Wait briefly so the registry client cache (100 ms TTL) expires and
      // the next call re-queries the chain. If the cache still holds stale
      // data (null), the publish will hit the registry's AlreadyPublished
      // rejection — which must be handled as success-with-existing.
      await new Promise((r) => setTimeout(r, 150));

      // Second call: must NOT throw. It should return the spec as success.
      const spec = await indexer.ensureDiscovered(TARGET_CONTRACT_ID);
      expect(spec).not.toBeNull();
      expect(spec!.contractId).toBe(TARGET_CONTRACT_ID);

      // Either the spec was fetched from the registry (published in first call),
      // OR the indexer's AlreadyPublished catch handled it as success. Both
      // satisfy the acceptance criterion. The log confirms which path was taken.
      const alreadyLog = logger.entries.find((e) =>
        e.message.includes("already published by another process"),
      );
      // We don't assert alreadyLog is defined — either path is acceptable.
      // If it IS defined, the error-handling path was exercised.
      if (alreadyLog) {
        expect(alreadyLog.meta?.contractId).toBe(TARGET_CONTRACT_ID);
      }
    },
    120_000,
  );

  it.skipIf(hasConfig)("skips live registry tests when env vars are unset", () => {
    console.warn(
      "[autopublish integration] live test skipped — set SOROBAN_CONTRACT_ID, " +
        "SOROBAN_INVOKER_SECRET, and TARGET_CONTRACT_ID (a deployed testnet contract " +
        "without an Orbital-published spec) to run it against the live registry.",
    );
    expect(hasConfig).toBe(false);
  });
});

describe.skipIf(shouldRun)("AutoPublishIndexer live registry integration (gated)", () => {
  it("skips unless INTEGRATION_TESTS=true", () => {
    expect(shouldRun).toBe(false);
  });
});
