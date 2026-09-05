/**
 * Vault client contract (issue #1070, "22.3 Copy-trade worker on the vault
 * pattern"). "Executed strictly through 22.1's vault, so the worker's
 * authority never exceeds 'call a constrained function'."
 *
 * NOTE ON SCOPE: 22.1 ("Soroban vault contract with hard constraints") is
 * open, and `contracts/vault` is a placeholder crate with no `#[contract]`,
 * no storage and no entry points - it exists only so #1069's `#[ignore]`d
 * property/fuzz specs compile. `VaultClient` is
 * therefore a specification - the shape a real vault-calling client must
 * satisfy - not a working implementation. `UNIMPLEMENTED_VAULT_CLIENT` (in
 * `index.ts`) is the only value of this type shipped here, and every method
 * on it throws.
 *
 * The whole point of this interface is structural: nothing in
 * `workers/copyTrade.ts` reads a private key, holds a balance, or has any
 * capability beyond calling the methods declared here. "The worker holds no
 * subscriber assets at any point" is enforced by *what this interface does
 * not expose*, not by a runtime check.
 */

/**
 * Per-subscriber constraints the vault contract enforces, as read by a
 * worker before proposing a trade. Everything here is data the vault itself
 * is the source of truth for; a worker must not cache these values past a
 * single decision cycle.
 */
export interface VaultConfig {
  vaultId: string;
  /** The subscriber whose funds this vault instance holds. */
  subscriberAccount: string;
  /** Maximum position size (raw, asset-native units) any single trade may reach. */
  maxPositionSizeRaw: bigint;
  /** Assets the vault will trade. A trade targeting anything else is skipped, not attempted. */
  allowListedAssets: readonly string[];
  /** Pools/venues the vault will route through. Same skip-not-attempt rule as assets. */
  allowListedPools: readonly string[];
  /** Maximum slippage the vault's contract-level check permits, in basis points. */
  slippageBoundBps: number;
}

export interface VaultExecutionRequest {
  vaultId: string;
  asset: string;
  pool: string;
  side: "buy" | "sell";
  /** Raw (asset-native) size, already bounded by `VaultConfig.maxPositionSizeRaw`. */
  sizeRaw: bigint;
  /** Passed to the contract's own slippage check - see `docs/design/worker-guard-rails.md` (22.5). */
  maxSlippageBps: number;
}

export type VaultExecutionResult =
  | { status: "executed"; txHash: string; executedAtUnix: number }
  | { status: "reverted"; reason: "slippage_exceeded"; txHash: string };

/**
 * What a worker is allowed to do to a vault: read its subscriber-set
 * configuration, and request one constrained trade. There is no deposit,
 * withdraw, or arbitrary-call method - a worker that needs one of those has
 * exceeded the "call a constrained function" boundary this issue exists to
 * enforce, which is a design bug in the worker, not a missing method here.
 */
export interface VaultClient {
  getConfig(vaultId: string): Promise<VaultConfig>;
  execute(request: VaultExecutionRequest): Promise<VaultExecutionResult>;
}
