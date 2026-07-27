import { createHash } from "node:crypto";
import type { ContractSpec, SpecSource, ResolvedSpec } from "./spec.js";
import { canonicalizeSpec } from "./spec.js";

/**
 * Minimal structural interface every ABI registry client in this package
 * happens to satisfy (`AbiRegistryClient`, `LocalAbiRegistryClient`,
 * `OnChainAbiRegistryClient`, `BundledWellKnownClient`) - matches
 * pulse-core's `AbiRegistryClientLike` without importing pulse-core (which
 * depends on this package; importing back would be circular).
 *
 * Clients that declare a {@link specSource} participate in provenance
 * tracking: {@link ChainedAbiRegistryClient.getResolvedSpec} wraps the
 * winning result with the source tag so consumers can display where a
 * spec came from.
 */
export interface AbiRegistryReader {
  getSpec(contractId: string): Promise<unknown>;
  getSpecAt?(contractId: string, ledger: number): Promise<unknown>;
  /** Declares the provenance category this client represents. */
  readonly specSource?: SpecSource;
}

/**
 * Tries each client in order, returning the first non-null result. Used to
 * compose a resolution chain - e.g. bundled offline specs first, falling
 * through to the on-chain registry for anything not bundled.
 */
export class ChainedAbiRegistryClient implements AbiRegistryReader {
  constructor(private readonly clients: readonly AbiRegistryReader[]) {}

  async getSpec(contractId: string): Promise<unknown> {
    for (const client of this.clients) {
      const result = await client.getSpec(contractId);
      if (result != null) return result;
    }
    return null;
  }

  async getSpecAt(contractId: string, ledger: number): Promise<unknown> {
    for (const client of this.clients) {
      const result = client.getSpecAt
        ? await client.getSpecAt(contractId, ledger)
        : await client.getSpec(contractId);
      if (result != null) return result;
    }
    return null;
  }

  /**
   * Resolves a spec with provenance metadata and cross-source conflict
   * detection. Unlike {@link getSpec}, this method:
   *
   * 1. Returns a {@link ResolvedSpec} carrying the winning client's
   *    {@link SpecSource} so consumers can display where the spec came from.
   * 2. Continues past the winner to check remaining clients for
   *    disagreements - if an embedded SEP-48 spec and a registry attestation
   *    produce different canonical hashes, a warning is emitted naming both
   *    hashes so operators can investigate the drift.
   *
   * The precedence order is determined solely by client insertion order
   * (owned by issue 7.9's tests) - this method does not alter it.
   */
  async getResolvedSpec(contractId: string): Promise<ResolvedSpec | null> {
    let winner: { spec: ContractSpec; source: SpecSource } | null = null;

    for (const client of this.clients) {
      const result = await client.getSpec(contractId);
      if (result == null) continue;

      if (winner == null) {
        winner = {
          spec: result as ContractSpec,
          source: client.specSource ?? "discovery",
        };
        // Don't break - continue to check remaining clients for conflicts.
      } else {
        // A later client also returned a spec. Check for disagreement.
        this.warnOnDisagreement(contractId, winner, {
          spec: result as ContractSpec,
          source: client.specSource ?? "discovery",
        });
      }
    }

    if (!winner) return null;
    return { spec: winner.spec, specSource: winner.source };
  }

  /**
   * Compares two specs by their canonical sha256 hash. If the hashes differ,
   * emits a `console.warn` naming both sources and truncated hashes so
   * operators can investigate the mismatch.
   */
  private warnOnDisagreement(
    contractId: string,
    winner: { spec: ContractSpec; source: SpecSource },
    other: { spec: ContractSpec; source: SpecSource },
  ): void {
    const winnerHash = createHash("sha256").update(canonicalizeSpec(winner.spec)).digest("hex");
    const otherHash = createHash("sha256").update(canonicalizeSpec(other.spec)).digest("hex");

    if (winnerHash !== otherHash) {
      console.warn(
        `[abi-registry] Spec disagreement for ${contractId}: ` +
          `${winner.source} (${winnerHash.slice(0, 12)}…) vs ` +
          `${other.source} (${otherHash.slice(0, 12)}…). ` +
          `Using ${winner.source} as canonical.`,
      );
    }
  }
}
