import { defineConfig } from "@orbital-stellar/abi-registry";

/**
 * `orbital codegen` input (issue #908). Generates typed params/returns, zod
 * schemas, and event type guards for two contracts:
 *
 * - `demoEmitter` - this repo's deployed testnet demo-emitter contract
 *   (`contracts/deployed.testnet.json`), a real Rust contract whose spec is
 *   discovered from its on-chain WASM.
 * - `usdc` - a mainnet well-known Stellar Asset Contract. SACs have no
 *   embedded contractspecv0 section (they're the protocol's built-in asset
 *   wrapper, not a compiled Rust crate), so this resolves through this
 *   repo's bundled well-known specs instead - the per-contract `network`
 *   override is what lets it sit in the same config as a testnet contract.
 *
 * Regenerate after either contract's spec changes:
 *   pnpm codegen
 * Check for drift without writing (what CI runs):
 *   pnpm codegen:check
 */
export default defineConfig({
  contracts: [
    { contractId: "CBGPM7FULEXM2WO4USIPC6XDJXKFUODU3EFAOVUZTJRAW4EJ2ZUA7PBJ", name: "demoEmitter" },
    {
      contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      name: "usdc",
      network: "mainnet",
    },
  ],
  network: "testnet",
  outDir: "./src/generated",
});
