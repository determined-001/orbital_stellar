import { createHash } from "node:crypto";
import {
  Account,
  Contract,
  Keypair,
  TransactionBuilder,
  BASE_FEE,
  rpc as SorobanRpc,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { TtlLruCache, DEFAULT_MAX_CACHE_SIZE, DEFAULT_CACHE_TTL_MS } from "./TtlLruCache.js";
import { validateSpec } from "./spec.js";
import type { ContractSpec } from "./spec.js";

export type OnChainAbiRegistryClientConfig = {
  /** The deployed registry contract's ID (see contracts/registry). */
  contractId: string;
  /** Soroban RPC endpoint, e.g. "https://soroban-testnet.stellar.org". */
  rpcUrl: string;
  /** Network passphrase for the target network (e.g. `Networks.TESTNET`). */
  networkPassphrase: string;
  /**
   * On-chain `publisher` address to resolve specs under - the registry keys
   * every spec by `(contract_id, publisher, version)`, so a resolver must
   * pick whose publications it trusts. Pass Orbital's canonical publisher
   * address to resolve the specs Orbital itself publishes (well-known specs,
   * auto-discovered specs), or a team's own address to resolve their
   * self-published overrides.
   */
  publisher: string;
  /** Fetch implementation used to retrieve each record's spec blob at `pointer`. Defaults to the global fetch. */
  transport?: typeof fetch;
  /** Maximum number of contracts' version lists / resolved specs to keep cached. Defaults to 512. */
  maxCacheSize?: number;
  /** Time-to-live for cached entries in milliseconds. Defaults to 5 minutes. */
  cacheTtlMs?: number;
};

type SpecRecord = {
  version: string;
  specHash: string; // hex
  pointer: string;
  publisher: string;
  publishedAt: string;
  publishedAtLedger: number;
};

/**
 * Resolves {@link ContractSpec}s by reading the on-chain Orbital ABI registry
 * contract directly via Soroban RPC simulation (no HTTP registry server
 * involved). For each `(contract_id, publisher)` pair this fetches every
 * published version's `SpecRecord` (hash + off-chain pointer), then - on
 * `getSpec`/`getSpecAt` - fetches the pointed-at blob and verifies its sha256
 * matches the on-chain `spec_hash` before returning it. A hash mismatch
 * throws rather than silently returning a possibly-tampered spec.
 *
 * Read-only: every RPC call here is a `simulateTransaction`, signed by a
 * throwaway, unfunded keypair. Simulation never touches the source account's
 * balance or sequence number, so no funded key is needed just to resolve
 * specs - only {@link OnChainRegistryPublisher} (which submits a real,
 * fee-paying transaction) needs one. This "unfunded source is sufficient for
 * simulation" assumption should be verified against a live network before
 * relying on it in production; it has not been exercised against a deployed
 * registry contract as part of this change.
 */
export class OnChainAbiRegistryClient {
  private readonly transport: typeof fetch;
  private readonly recordsCache: TtlLruCache<SpecRecord[]>;
  private readonly specCache: TtlLruCache<ContractSpec | null>;

  constructor(private readonly config: OnChainAbiRegistryClientConfig) {
    this.transport = config.transport ?? fetch.bind(globalThis);
    const ttlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    const maxSize = config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
    this.recordsCache = new TtlLruCache(ttlMs, maxSize);
    this.specCache = new TtlLruCache(ttlMs, maxSize);
  }

  /** Resolves the most recently published spec for `contractId`, or `null` if none has been published. */
  async getSpec(contractId: string): Promise<ContractSpec | null> {
    const records = await this.getRecords(contractId);
    if (records.length === 0) return null;
    return this.resolveRecord(contractId, records[records.length - 1]!);
  }

  clearCache(): void {
    this.recordsCache.clear();
    this.specCache.clear();
  }

  /**
   * Resolves whichever spec version was current as of `ledger` - the most
   * recently published version whose `published_at_ledger` is `<= ledger`.
   * Returns `null` if no version had been published yet at that ledger.
   */
  async getSpecAt(contractId: string, ledger: number): Promise<ContractSpec | null> {
    const records = await this.getRecords(contractId);
    let candidate: SpecRecord | undefined;
    for (const record of records) {
      if (
        record.publishedAtLedger <= ledger &&
        (!candidate || record.publishedAtLedger > candidate.publishedAtLedger)
      ) {
        candidate = record;
      }
    }
    if (!candidate) return null;
    return this.resolveRecord(contractId, candidate);
  }

  private async getRecords(contractId: string): Promise<SpecRecord[]> {
    const cached = this.recordsCache.get(contractId);
    if (cached !== undefined) return cached;

    const versions = await this.simulateListVersions(contractId);
    const records = await Promise.all(
      versions.map((version) => this.simulateGetVersion(contractId, version)),
    );
    const resolved = records.filter((r): r is SpecRecord => r !== null);
    this.recordsCache.set(contractId, resolved);
    return resolved;
  }

  private async resolveRecord(
    contractId: string,
    record: SpecRecord,
  ): Promise<ContractSpec | null> {
    const cacheKey = `${contractId}@${record.version}`;
    const cached = this.specCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.transport(record.pointer);
    if (!response.ok) {
      throw new Error(
        `OnChainAbiRegistryClient: failed to fetch spec blob at ${record.pointer} (${response.status})`,
      );
    }
    const text = await response.text();
    const actualHash = createHash("sha256").update(text).digest("hex");
    if (actualHash !== record.specHash) {
      throw new Error(
        `OnChainAbiRegistryClient: spec_hash mismatch for ${contractId}@${record.version} - expected ${record.specHash}, got ${actualHash}. The fetched blob does not match the on-chain hash and was not returned.`,
      );
    }

    const spec = JSON.parse(text) as ContractSpec;
    const validation = validateSpec(spec);
    if (!validation.valid) {
      throw new Error(
        `OnChainAbiRegistryClient: fetched spec for ${contractId}@${record.version} failed validation:\n${validation.errors
          .map((e) => `  - ${e}`)
          .join("\n")}`,
      );
    }

    this.specCache.set(cacheKey, spec);
    return spec;
  }

  private async simulateListVersions(targetContractId: string): Promise<string[]> {
    const retval = await this.simulate("list_versions", [
      nativeToScVal(targetContractId, { type: "address" }),
      nativeToScVal(this.config.publisher, { type: "address" }),
    ]);
    if (!retval) return [];
    return (scValToNative(retval) as unknown[]).map((v) => String(v));
  }

  private async simulateGetVersion(
    targetContractId: string,
    version: string,
  ): Promise<SpecRecord | null> {
    const retval = await this.simulate("get_version", [
      nativeToScVal(targetContractId, { type: "address" }),
      nativeToScVal(this.config.publisher, { type: "address" }),
      nativeToScVal(version, { type: "string" }),
    ]);
    if (!retval) return null;
    const native = scValToNative(retval) as Record<string, unknown> | null;
    if (!native) return null;
    return {
      version: String(native["version"]),
      specHash: Buffer.from(native["spec_hash"] as Uint8Array).toString("hex"),
      pointer: String(native["pointer"]),
      publisher: String(native["publisher"]),
      publishedAt: String(native["published_at"]),
      publishedAtLedger: Number(native["published_at_ledger"]),
    };
  }

  private async simulate(fn: string, args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
    const server = new SorobanRpc.Server(this.config.rpcUrl);
    // Throwaway, unfunded source - see the class doc comment above.
    const source = new Account(Keypair.random().publicKey(), "0");
    const contract = new Contract(this.config.contractId);

    const tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(fn, ...args))
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(`OnChainAbiRegistryClient: simulation of "${fn}" failed: ${sim.error}`);
    }
    if (!("result" in sim) || !sim.result) return null;
    return sim.result.retval;
  }
}
