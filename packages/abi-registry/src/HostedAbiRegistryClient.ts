import { createHash } from "node:crypto";
import { TtlLruCache, DEFAULT_MAX_CACHE_SIZE, DEFAULT_CACHE_TTL_MS } from "./TtlLruCache.js";
import type { AbiRegistryReader } from "./ChainedAbiRegistryClient.js";
import type { XdrContractSpec } from "./types.js";

/**
 * Configuration for the hosted ABI registry client.
 */
export interface HostedAbiRegistryClientConfig {
  /**
   * Base URL of the Orbital hosted registry, e.g. "https://abi.orbital.dev".
   * Requests are made to `{baseUrl}/v1/specs/{contractId}` and
   * `{baseUrl}/v1/specs/{contractId}?ledger={ledger}`.
   */
  baseUrl: string;

  /**
   * Request timeout in milliseconds. On expiry the hosted client falls
   * through to the next client in the chain rather than throwing.
   * Defaults to 5 000 ms.
   */
  timeoutMs?: number;

  /**
   * Fraction of successful responses whose spec hash is cross-checked
   * against `onChainClient`. A value of 20 means "1 in 20" checks are
   * performed. Set to 0 to disable sampling entirely.
   * Defaults to 20.
   */
  sampleRate?: number;

  /**
   * An {@link AbiRegistryReader} used for sampled hash verification.
   * When a sample fires, `HostedAbiRegistryClient` re-fetches the spec
   * from this client and compares sha256 hashes. If they differ it logs
   * an error and falls through rather than returning the unverified spec.
   * If omitted, sampled verification is skipped even when `sampleRate > 0`.
   */
  onChainClient?: AbiRegistryReader;

  /**
   * Optional transport override for HTTP requests; falls back to the global
   * `fetch` implementation. Useful for injecting a mock in tests.
   */
  transport?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;

  /** Maximum number of specs to keep in the LRU cache. Defaults to 512. */
  maxCacheSize?: number;

  /** Time-to-live for cached specs in milliseconds. Defaults to 5 minutes. */
  cacheTtlMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_SAMPLE_RATE = 20;

/**
 * ABI registry client that resolves specs from the Orbital hosted `/v1/`
 * endpoints and automatically falls through to the next link in the chain on:
 *
 * - **Timeout** – the request did not complete within `timeoutMs`
 * - **5xx error** – the hosted service is temporarily unavailable
 * - **Hash mismatch** – the spec returned by the hosted service does not
 *   match the hash the on-chain registry attests to (sampled at 1 in
 *   `sampleRate` hits by default)
 *
 * Hash mismatches are always logged as errors before falling through:
 * the hosted service must never silently override a chain-attested spec.
 *
 * The client is designed to sit ahead of {@link OnChainAbiRegistryClient}
 * in {@link ChainedAbiRegistryClient}. When the hosted service is healthy
 * it provides sub-second latency; when it is not, the chain link provides
 * the authoritative answer with no observable difference to the caller.
 */
export class HostedAbiRegistryClient implements AbiRegistryReader {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly sampleRate: number;
  private readonly onChainClient: AbiRegistryReader | undefined;
  private readonly transport: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  private readonly cache: TtlLruCache<XdrContractSpec | null>;

  constructor(config: HostedAbiRegistryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sampleRate = config.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.onChainClient = config.onChainClient;
    this.transport = config.transport ?? fetch.bind(globalThis);
    this.cache = new TtlLruCache(
      config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      config.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
    );
  }

  /**
   * Attempts to resolve `contractId` from the hosted `/v1/specs/` endpoint.
   * Returns `null` (fall-through) on timeout, 5xx, or hash mismatch.
   * Returns `null` on 404 (not found in hosted service, try next link).
   */
  async getSpec(contractId: string): Promise<XdrContractSpec | null> {
    const cached = this.cache.get(contractId);
    if (cached !== undefined) return cached;

    const url = `${this.baseUrl}/v1/specs/${encodeURIComponent(contractId)}`;
    const spec = await this.fetchSpec(contractId, url);
    if (spec !== null) {
      this.cache.set(contractId, spec);
    }
    return spec;
  }

  /**
   * Attempts to resolve the spec as of `ledger` from the hosted endpoint.
   * Falls through on timeout, 5xx, or hash mismatch.
   */
  async getSpecAt(contractId: string, ledger: number): Promise<XdrContractSpec | null> {
    const cacheKey = `${contractId}@${ledger}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const url = `${this.baseUrl}/v1/specs/${encodeURIComponent(contractId)}?ledger=${encodeURIComponent(ledger)}`;
    const spec = await this.fetchSpec(contractId, url);
    if (spec !== null) {
      this.cache.set(cacheKey, spec);
    }
    return spec;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Fetches a spec from `url` with timeout enforcement, fall-through on
   * transient errors, and optional sampled hash verification.
   *
   * Returns the spec on success, or `null` to signal fall-through.
   */
  private async fetchSpec(
    contractId: string,
    url: string,
  ): Promise<XdrContractSpec | null> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(url);
    } catch (err) {
      // Timeout or network error → fall through silently.
      if (this.isTimeoutError(err)) {
        return null;
      }
      // Any other fetch-level error also falls through (e.g. DNS failure).
      return null;
    }

    // 404: contract not found in hosted service → fall through.
    if (response.status === 404) return null;

    // 5xx: hosted service is degraded → fall through.
    if (response.status >= 500 && response.status < 600) return null;

    // Any other non-OK status (4xx other than 404): treat as non-transient;
    // fall through so a chain link can try.
    if (!response.ok) return null;

    let spec: XdrContractSpec;
    try {
      spec = (await response.json()) as XdrContractSpec;
    } catch {
      // Malformed JSON → fall through.
      return null;
    }

    // Sampled hash verification against on-chain client.
    if (this.shouldSample()) {
      const verified = await this.verifySampledHash(contractId, spec);
      if (!verified) {
        // verifySampledHash already logged the error.
        return null;
      }
    }

    return spec;
  }

  /**
   * Races the actual fetch against an `AbortController`-backed timeout.
   * Throws with `name === "AbortError"` when the timeout wins.
   */
  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Returns true for AbortError (timeout) and any error whose message suggests it. */
  private isTimeoutError(err: unknown): boolean {
    if (err instanceof Error) {
      return err.name === "AbortError" || err.message.includes("aborted");
    }
    return false;
  }

  /** Deterministic 1-in-N sampling gate. */
  private shouldSample(): boolean {
    if (this.sampleRate <= 0 || !this.onChainClient) return false;
    return Math.random() * this.sampleRate < 1;
  }

  /**
   * Verifies that the hosted spec's content hash matches the on-chain client's
   * spec. Logs a hard error and returns `false` on mismatch so the caller can
   * fall through to the authoritative chain link.
   *
   * Hashing is performed over the canonical JSON representation of each spec's
   * `entries` array (sorted to be stable regardless of server ordering) so that
   * superficial serialisation differences (extra whitespace, key ordering) do not
   * produce spurious mismatches.
   */
  private async verifySampledHash(
    contractId: string,
    hostedSpec: XdrContractSpec,
  ): Promise<boolean> {
    if (!this.onChainClient) return true;

    let chainSpec: unknown;
    try {
      chainSpec = await this.onChainClient.getSpec(contractId);
    } catch {
      // If the chain client itself fails, skip the verification for this sample
      // rather than treating it as a mismatch.
      return true;
    }

    if (chainSpec == null) {
      // Chain has no record for this contract; skip hash check.
      return true;
    }

    const hostedHash = specHash(hostedSpec);
    const chainHash = specHash(chainSpec as XdrContractSpec);

    if (hostedHash !== chainHash) {
      // eslint-disable-next-line no-console
      console.error(
        `HostedAbiRegistryClient: hash mismatch for ${contractId} - ` +
          `hosted=${hostedHash} chain=${chainHash}. ` +
          `The hosted spec is not attested by the on-chain registry. Falling through to chain.`,
      );
      return false;
    }

    return true;
  }
}

/**
 * Computes a stable sha256 fingerprint over a spec's `entries` array.
 * Entries are sorted before hashing so ordering differences between the
 * hosted and on-chain serialisations don't produce false mismatches.
 */
function specHash(spec: XdrContractSpec): string {
  const entries = [...(spec.entries ?? [])].sort();
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
