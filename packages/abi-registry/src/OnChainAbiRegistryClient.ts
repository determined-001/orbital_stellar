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

export type SpecRecord = {
  version: string;
  specHash: string; // hex
  pointer: string;
  publisher: string;
  publishedAt: string;
  publishedAtLedger: number;
};

/** One contract's most-recently-observed publication, as surfaced by {@link OnChainAbiRegistryClient.listRegisteredContracts}. */
export type RegisteredContractSummary = {
  contractId: string;
  publisher: string;
  /** The highest-ledger version seen within the scanned window - not necessarily the contract's true latest version if an even-more-recent publish falls outside the lookback window. */
  latestVersion: string;
  specHash: string; // hex
  pointer: string;
  publishedAtLedger: number;
};

export type ListRegisteredContractsOptions = {
  /**
   * How many ledgers of registry history to scan for `SpecPublished` events,
   * counting back from the chain's current latest ledger. Soroban RPC
   * providers only retain a bounded window of event history (commonly on the
   * order of a week's worth of ledgers) - this is **not** a complete
   * historical index of every contract ever published, only what's still
   * within the configured RPC's retention window. A contract published
   * outside this window simply won't appear. Defaults to
   * {@link DEFAULT_LOOKBACK_LEDGERS}.
   */
  lookbackLedgers?: number;
  /** Restrict results to a specific publisher's namespace. Defaults to `config.publisher`. */
  publisher?: string;
  /** Max events fetched per `getEvents` page. Defaults to 100. */
  pageLimit?: number;
};

/** ~24h at Stellar's ~5s average ledger close time. A conservative default - most RPC providers retain considerably more, but 24h is safe to assume without probing the specific provider's retention window. */
export const DEFAULT_LOOKBACK_LEDGERS = 17_280;

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

  /** Every published version's record for `contractId`, oldest first, under `config.publisher`'s namespace. Empty array if none have been published. */
  async listVersions(contractId: string): Promise<SpecRecord[]> {
    return this.getRecords(contractId);
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

  /**
   * Enumerates contracts that have published a spec to this registry, by
   * scanning the registry contract's own historical `SpecPublished` events
   * via `getEvents` and keeping the highest-ledger record seen per
   * `contract_id`.
   *
   * There is no on-chain index of "all registered contracts" - the registry
   * contract keys every record by `(contract_id, publisher, version)`, so
   * this is the only way to enumerate its contents. Consequently this method
   * is a **bounded, best-effort scan**, not a complete listing: it only sees
   * as far back as `options.lookbackLedgers` (see {@link DEFAULT_LOOKBACK_LEDGERS})
   * and only as far back as the configured RPC endpoint's own event-history
   * retention allows, whichever is shorter. Treat an empty or partial result
   * as "nothing observed in the scanned window", not "nothing published".
   */
  async listRegisteredContracts(
    options: ListRegisteredContractsOptions = {},
  ): Promise<RegisteredContractSummary[]> {
    const server = new SorobanRpc.Server(this.config.rpcUrl);
    const publisherFilter = options.publisher ?? this.config.publisher;
    const pageLimit = options.pageLimit ?? 100;

    const { sequence: latestLedger } = await server.getLatestLedger();
    const startLedger = Math.max(
      1,
      latestLedger - (options.lookbackLedgers ?? DEFAULT_LOOKBACK_LEDGERS),
    );

    const byContract = new Map<string, RegisteredContractSummary>();
    let cursor: string | undefined;

    for (;;) {
      const page = await server.getEvents({
        ...(cursor ? { cursor } : { startLedger }),
        filters: [{ type: "contract", contractIds: [this.config.contractId] }],
        limit: pageLimit,
      });

      for (const event of page.events) {
        const summary = this.parseSpecPublishedEvent(event, publisherFilter);
        if (!summary) continue;
        const existing = byContract.get(summary.contractId);
        if (!existing || summary.publishedAtLedger > existing.publishedAtLedger) {
          byContract.set(summary.contractId, summary);
        }
      }

      if (page.events.length < pageLimit) break;
      const last = page.events[page.events.length - 1];
      // `cursor` at the page level is preferred when the RPC provider
      // returns one; falling back to the last event's own paging token keeps
      // this working against providers that only surface per-event tokens.
      cursor = (page as { cursor?: string }).cursor ?? last?.pagingToken;
      if (!cursor) break;
    }

    return [...byContract.values()].sort((a, b) => a.contractId.localeCompare(b.contractId));
  }

  /**
   * Decodes one raw `getEvents` record as a `SpecPublished` event, or returns
   * `null` if it isn't one (wrong topic shape, wrong publisher, or any
   * decoding failure) - this is a best-effort scan over a contract's full
   * event history, so unrelated/malformed events are skipped, not fatal.
   *
   * Topic layout follows `#[contractevent]`'s convention (mirrored by
   * `decode.ts` elsewhere in this package): `topic[0]` is the event's name
   * symbol, followed by its `#[topic]`-marked fields in declaration order -
   * here, `SpecPublished { contract_id, version, .. }`, so `topic[1]` is
   * `contract_id` and `topic[2]` is `version`. The remaining, non-topic
   * fields (`spec_hash`, `pointer`, `publisher`) are in the event's `value`.
   */
  private parseSpecPublishedEvent(
    event: { topic: unknown[]; value: unknown; ledger: number },
    publisherFilter: string,
  ): RegisteredContractSummary | null {
    try {
      const topics = event.topic.map((t) => this.scValToNativeLoose(t));
      if (topics.length < 3) return null;

      const contractId = String(topics[1]);
      const version = String(topics[2]);

      const data = this.scValToNativeLoose(event.value) as Record<string, unknown>;
      const publisher = String(data["publisher"]);
      if (publisher !== publisherFilter) return null;

      return {
        contractId,
        publisher,
        latestVersion: version,
        specHash: Buffer.from(data["spec_hash"] as Uint8Array).toString("hex"),
        pointer: String(data["pointer"]),
        publishedAtLedger: event.ledger,
      };
    } catch {
      return null;
    }
  }

  /** Accepts either an already-parsed `xdr.ScVal` or a raw base64 XDR string, and returns its native JS value either way - different RPC transports/SDK versions surface `topic`/`value` in either form. */
  private scValToNativeLoose(value: unknown): unknown {
    if (value instanceof xdr.ScVal) return scValToNative(value);
    if (typeof value === "string") return scValToNative(xdr.ScVal.fromXDR(value, "base64"));
    return value;
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
