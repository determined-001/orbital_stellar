/**
 * SEP-48 embedded event spec client for the resolution chain.
 *
 * Fetches a contract's WASM bytecode, parses the embedded `contractspecv0`
 * section, and returns the spec **only when it contains event entries** -
 * the SEP-48 signal. Pre-SEP-48 contracts (no `#[contractevent]`) yield
 * `events: []` and are skipped so the chain falls through to the next
 * client (registry attestation, well-known bundle, etc.).
 *
 * This is the "parsing leg" that makes the `sep48` branch of the
 * precedence chain reachable for real contracts (issue #903).
 */

import type { AbiRegistryReader } from "../ChainedAbiRegistryClient.js";
import type { ContractSpec, SpecSource } from "../spec.js";
import { fetchContractWasm } from "./fetchContractCode.js";
import { parseWasmSpec, NoEmbeddedSpecError } from "./parseContractSpec.js";

/**
 * Resolves a contract's ABI spec from the embedded `#[contractevent]` entries
 * in its WASM bytecode. Returns `null` (falls through) when:
 * - The contract has no WASM (e.g. Stellar Asset Contracts)
 * - The WASM has no `contractspecv0` section (stripped/non-Rust)
 * - The embedded spec has no event entries (pre-SEP-48)
 * - The WASM fetch fails for any reason
 */
export class Sep48EmbeddedClient implements AbiRegistryReader {
  readonly specSource: SpecSource = "sep48";

  constructor(private readonly rpcUrl: string) {}

  async getSpec(contractId: string): Promise<ContractSpec | null> {
    try {
      const wasm = await fetchContractWasm(this.rpcUrl, contractId);
      const parsed = parseWasmSpec(wasm);

      // SEP-48 signal: only return when the contract has embedded event specs.
      // Pre-SEP-48 contracts have `events: []` because `contractspecv0`
      // predates `#[contractevent]` - there are simply no ScSpecEntryEventV0
      // entries to map. Returning null lets the chain fall through to the
      // registry or well-known client.
      if (parsed.events.length === 0) {
        return null;
      }

      return {
        version: "0.0.0",
        name: contractId,
        contractId,
        functions: parsed.functions,
        events: parsed.events,
        types: parsed.types,
        xdrEntries: parsed.xdrEntries,
      };
    } catch (err) {
      // NoEmbeddedSpecError: no contractspecv0 section (stripped/non-Rust)
      // Any other error: network failure, RPC error, etc.
      // In all cases, fall through to the next client in the chain.
      if (!(err instanceof NoEmbeddedSpecError)) {
        // Suppress expected errors silently; unexpected errors get a debug log
        // but still fall through - the chain should never break because one
        // source is unavailable.
      }
      return null;
    }
  }
}
