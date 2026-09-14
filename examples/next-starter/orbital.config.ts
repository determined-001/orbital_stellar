/**
 * `orbital codegen` input (issue #908). See express-starter's
 * orbital.config.ts for the full explanation of why USDC needs its own
 * `network: "mainnet"` override alongside the testnet demo-emitter.
 *
 * No `defineConfig`/`OrbitalConfig` import here, deliberately: unlike
 * express-starter and anchor-starter, this starter's whole point is to
 * install only from npm (#896) - `@orbital-stellar/abi-registry`'s last
 * published version predates the per-contract network override this config
 * needs (#1132), so it isn't a dependency here at all. `codegen`/
 * `codegen:check` in package.json invoke this repo's own workspace build
 * directly by relative path instead. `defineConfig` is an identity
 * function; a plain object is exactly as valid as its input.
 */
export default {
  contracts: [
    { contractId: "CBGPM7FULEXM2WO4USIPC6XDJXKFUODU3EFAOVUZTJRAW4EJ2ZUA7PBJ", name: "demoEmitter" },
    {
      contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      name: "usdc",
      network: "mainnet",
    },
  ],
  network: "testnet",
  outDir: "./lib/generated",
};
