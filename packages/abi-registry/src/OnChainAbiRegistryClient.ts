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
import { validateSpec, canonicalizeSpec } from "./spec.js";
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
  /**
   * Locally-held spec blobs, keyed by their canonical sha256 - the same hash
   * the registry stores on chain.
   *
   * Content addressing is what makes this safe rather than merely fast: a hit
   * means the bytes in hand are provably the bytes the chain names, so fetching
   * the pointer to confirm what the hash already proves is a round trip for
   * nothing. A miss falls through to the pointer exactly as before.
   *
   * This matters most where it is least convenient. Resolving a spec otherwise
   * needs the RPC *and* whatever host serves the pointer to both be reachable,
   * which is two chances to fail per spec on a slow network. A caller that
   * ships the well-known specs already holds every byte it would download.
   */
  offlineBlobs?: ReadonlyMap<string, string>;
  /**
   * Extra attempts after a *transport* failure - a request that never reached
   * the RPC. Defaults to 2, so three attempts in total, with 150ms then 300ms
   * of backoff.
   *
   * Deterministic failures are never retried; see {@link withTransportRetry}.
   * Set to 0 to fail on the first dropped connection.
   */
  transportRetries?: number;
};

/**
 * Thrown when the registry holds an entry for this key but the network has
 * archived it, so it can only be read again after someone pays a
 * `RestoreFootprint`.
 *
 * This is deliberately distinct from a `null` return, which means "never
 * published". The two are indistinguishable at the RPC layer unless you look
 * for the restore preamble: an archived persistent entry makes the host
 * refuse the invocation and the RPC answers with `restorePreamble` (the
 * footprint and minimum fee a restore would cost) rather than a result, while
 * a key that was never written simulates fine and returns void.
 */
export class RegistryEntryArchivedError extends Error {
  readonly contractId: string;
  readonly publisher: string;
  readonly registryContractId: string;
  /** Contract function whose simulation hit the archived entry. */
  readonly fn: string;
  /** Minimum fee, in stroops, the RPC quoted for the restore. Absent when the archival was reported as a plain simulation error. */
  readonly minResourceFee?: string;
  /** Base64 `SorobanTransactionData` for the restore transaction, when the RPC supplied a preamble. */
  readonly restoreTransactionData?: string;

  constructor(args: {
    contractId: string;
    publisher: string;
    registryContractId: string;
    fn: string;
    minResourceFee?: string;
    restoreTransactionData?: string;
    detail?: string;
  }) {
    super(
      `OnChainAbiRegistryClient: registry entry for ${args.contractId} (publisher ${args.publisher}) has been archived and must be restored before "${args.fn}" can read it` +
        (args.minResourceFee ? ` - restore costs at least ${args.minResourceFee} stroops` : "") +
        (args.detail ? `: ${args.detail}` : ""),
    );
    this.name = "RegistryEntryArchivedError";
    this.contractId = args.contractId;
    this.publisher = args.publisher;
    this.registryContractId = args.registryContractId;
    this.fn = args.fn;
    this.minResourceFee = args.minResourceFee;
    this.restoreTransactionData = args.restoreTransactionData;
  }
}

/**
 * Archived persistent entries surface either as a `restorePreamble` on an
 * otherwise-successful simulation or, depending on RPC version, as a
 * simulation error naming the archived/expired entry. Both are matched so the
 * distinction survives an RPC upgrade.
 */
const ARCHIVED_ENTRY_ERROR = /archiv|expired|EntryArchived|restore/i;

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

    // A blob whose canonical hash already matches the on-chain record needs no
    // fetch: that hash is the entire thing fetching the pointer would establish.
    const local = this.config.offlineBlobs?.get(record.specHash);
    let text: string;
    if (local !== undefined) {
      text = local;
    } else {
      const response = await this.transport(record.pointer);
      if (!response.ok) {
        throw new Error(
          `OnChainAbiRegistryClient: failed to fetch spec blob at ${record.pointer} (${response.status})`,
        );
      }
      text = await response.text();
    }

    let parsed: ContractSpec;
    try {
      parsed = JSON.parse(text) as ContractSpec;
    } catch {
      throw new Error(
        `OnChainAbiRegistryClient: spec blob at ${record.pointer} is not valid JSON.`,
      );
    }

    // Hash the CANONICAL form, not the bytes as served. `canonicalizeSpec`'s
    // contract is explicit that it "is what OnChainRegistryPublisher hashes
    // before publishing, and what any resolver must re-hash to verify a
    // fetched spec blob against the on-chain spec_hash".
    //
    // Hashing the raw response instead made every on-chain resolution fail:
    // the publisher hashes sorted-key compact JSON while the blob is served
    // pretty-printed, so the two never agreed and `getSpec` threw for every
    // seeded contract. It also made the hash hostage to formatting - a
    // re-serialising CDN, a trailing newline or a reformatted commit would
    // each have broken a spec that had not changed.
    const actualHash = createHash("sha256").update(canonicalizeSpec(parsed)).digest("hex");
    if (actualHash !== record.specHash) {
      throw new Error(
        `OnChainAbiRegistryClient: spec_hash mismatch for ${contractId}@${record.version} - expected ${record.specHash}, got ${actualHash}. The fetched blob does not match the on-chain hash and was not returned.`,
      );
    }

    const spec = parsed;
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

  /**
   * Pages through all published versions transparently by calling the
   * contract's `list_versions_paged` in a loop. Handles the truncation
   * marker from the deprecated `list_versions` path gracefully.
   */
  private async simulateListVersions(targetContractId: string): Promise<string[]> {
    const allVersions: string[] = [];
    let cursor: number | null = 0;

    while (cursor !== null) {
      const retval = await this.simulate(
        "list_versions_paged",
        [
          nativeToScVal(targetContractId, { type: "address" }),
          nativeToScVal(this.config.publisher, { type: "address" }),
          nativeToScVal(cursor, { type: "u32" }),
          nativeToScVal(25, { type: "u32" }), // MAX_PAGE_SIZE
        ],
        targetContractId,
      );

      if (!retval) break;

      const native = scValToNative(retval) as [string[], number | null];
      const [page, nextCursor] = native;

      for (const version of page) {
        // Skip truncation sentinel markers from the deprecated list_versions
        if (!version.startsWith("__truncated_")) {
          allVersions.push(version);
        }
      }

      cursor = nextCursor;
    }

    return allVersions;
  }

  private async simulateGetVersion(
    targetContractId: string,
    version: string,
  ): Promise<SpecRecord | null> {
    const retval = await this.simulate(
      "get_version",
      [
        nativeToScVal(targetContractId, { type: "address" }),
        nativeToScVal(this.config.publisher, { type: "address" }),
        nativeToScVal(version, { type: "string" }),
      ],
      targetContractId,
    );
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

  /**
   * Retries a call that failed to reach the RPC at all.
   *
   * Public Soroban RPC endpoints drop connections. Measured against
   * soroban-testnet.stellar.org: roughly one cold read in eight fails with a
   * bare `fetch failed` and no cause - not a slow response, a dropped one. A
   * page reading five contracts then has about even odds of at least one
   * failing, which is why the registry explorer reported an empty registry
   * against a registry that held four specs.
   *
   * Only *transport* failures are retried. A simulation error, an archived
   * entry, or a contract error is deterministic: the same call will fail the
   * same way, so retrying it just multiplies the wait before reporting what
   * was already known. Those propagate on the first attempt.
   */
  private async withTransportRetry<T>(call: () => Promise<T>, label: string): Promise<T> {
    const attempts = Math.max(1, (this.config.transportRetries ?? 2) + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await call();
      } catch (err) {
        lastError = err;
        // A thrown Error with no `cause` and a transport-shaped message is
        // undici failing to complete the request. Anything the RPC actually
        // answered comes back as a value, not a throw.
        if (attempt === attempts) break;
        await new Promise((r) => setTimeout(r, 150 * 2 ** (attempt - 1)));
      }
    }

    throw new Error(
      `OnChainAbiRegistryClient: RPC unreachable for ${label} after ${attempts} attempts: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
      { cause: lastError },
    );
  }

  private async simulate(
    fn: string,
    args: xdr.ScVal[],
    targetContractId: string,
  ): Promise<xdr.ScVal | null> {
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

    const sim = await this.withTransportRetry(
      () => server.simulateTransaction(tx),
      `${fn}(${targetContractId})`,
    );

    if (SorobanRpc.Api.isSimulationError(sim)) {
      if (ARCHIVED_ENTRY_ERROR.test(sim.error)) {
        throw this.archived(fn, targetContractId, { detail: sim.error });
      }
      throw new Error(`OnChainAbiRegistryClient: simulation of "${fn}" failed: ${sim.error}`);
    }

    // A restore preamble means the entry exists but has been archived: the
    // registry did publish it, and reading it again costs a RestoreFootprint.
    // Reporting this as a plain miss would tell callers the spec was never
    // published, which is a different (and unfixable) problem.
    const preamble = (
      sim as { restorePreamble?: { minResourceFee: string; transactionData?: unknown } }
    ).restorePreamble;
    if (preamble?.minResourceFee) {
      throw this.archived(fn, targetContractId, {
        minResourceFee: preamble.minResourceFee,
        restoreTransactionData: this.encodeRestoreData(preamble.transactionData),
      });
    }

    if (!("result" in sim) || !sim.result) return null;
    return sim.result.retval;
  }

  private archived(
    fn: string,
    targetContractId: string,
    extra: { minResourceFee?: string; restoreTransactionData?: string; detail?: string },
  ): RegistryEntryArchivedError {
    return new RegistryEntryArchivedError({
      contractId: targetContractId,
      publisher: this.config.publisher,
      registryContractId: this.config.contractId,
      fn,
      ...extra,
    });
  }

  /** The preamble's transactionData is an XDR object on modern SDKs and already a base64 string on older ones. */
  private encodeRestoreData(data: unknown): string | undefined {
    if (typeof data === "string") return data;
    const encodable = data as { toXDR?: (format: "base64") => string } | undefined;
    return typeof encodable?.toXDR === "function" ? encodable.toXDR("base64") : undefined;
  }
}
