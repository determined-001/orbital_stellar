import { describe, it, expect } from "vitest";
import { Networks } from "@stellar/stellar-sdk";
import {
  ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE,
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID,
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS,
} from "../src/registryConstants.js";

describe("registry constants", () => {
  it("keeps the testnet passphrase literal in step with the SDK", () => {
    // The literal exists so assembling the default registry chain - which runs
    // inside `new EventEngine()` - does not depend on the SDK's `Networks`
    // export being present. This test is what stops the two drifting: the
    // import lives here, in a test, not on the hot path.
    expect(ORBITAL_REGISTRY_TESTNET_NETWORK_PASSPHRASE).toBe(Networks.TESTNET);
  });

  it("has a deployed registry contract and publisher configured", () => {
    expect(ORBITAL_REGISTRY_TESTNET_CONTRACT_ID).toMatch(/^C[A-Z2-7]{55}$/);
    expect(ORBITAL_REGISTRY_PUBLISHER_ADDRESS).toMatch(/^G[A-Z2-7]{55}$/);
  });
});
