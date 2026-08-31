import type { VaultClient } from "./types.js";

export type {
  VaultConfig,
  VaultExecutionRequest,
  VaultExecutionResult,
  VaultClient,
} from "./types.js";

/**
 * Thrown by every method of `UNIMPLEMENTED_VAULT_CLIENT`. There is no real
 * vault contract in this repo yet (22.1 is open) - see the "NOTE ON SCOPE" in
 * `types.ts`.
 */
export class VaultNotImplementedError extends Error {
  constructor(method: string) {
    super(
      `VaultClient.${method}() is not implemented: the vault contract (22.1) does not exist yet. ` +
        "Pass a real VaultClient once one is available.",
    );
    this.name = "VaultNotImplementedError";
  }
}

/**
 * The only `VaultClient` value this package ships. Every method throws
 * `VaultNotImplementedError` - this exists so callers have a concrete,
 * type-correct value to pass around (tests, examples) without a real vault,
 * and so "no vault yet" fails loudly the moment it's actually used rather
 * than silently returning fabricated data.
 */
export const UNIMPLEMENTED_VAULT_CLIENT: VaultClient = {
  getConfig(): Promise<never> {
    return Promise.reject(new VaultNotImplementedError("getConfig"));
  },
  execute(): Promise<never> {
    return Promise.reject(new VaultNotImplementedError("execute"));
  },
};
