import { describe, it, expect, afterEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";
import { NetworkMismatchError } from "../src/errors.js";

describe("EventEngine network drift detection", () => {
  afterEach(() => {
    // Clear any cached network between tests
    SorobanRpcClient.setCachedNetwork(null);
  });

  it("throws NetworkMismatchError when cached Soroban RPC passphrase differs from configured network", () => {
    // Cache a mismatched passphrase (simulate RPC pointing to mainnet while engine configured for testnet)
    SorobanRpcClient.setCachedNetwork({
      passphrase: "Public Global Stellar Network ; September 2015",
    });

    const engine = new EventEngine({ network: "testnet" });

    expect(() => engine.start()).toThrow(NetworkMismatchError);
  });

  it("does not throw when cached passphrase matches expected network", () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: "Test SDF Network ; September 2015" });
    const engine = new EventEngine({ network: "testnet" });
    const started = engine.start();
    expect(started).toBe(true);
    engine.stop();
  });
});
