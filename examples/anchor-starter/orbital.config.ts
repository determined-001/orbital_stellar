import { defineConfig } from "@orbital-stellar/abi-registry";

/**
 * `orbital codegen` input (issue #908). See express-starter's
 * orbital.config.ts for the full explanation of why USDC needs its own
 * `network: "mainnet"` override alongside the testnet demo-emitter.
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
