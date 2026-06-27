import { describe, it, expect } from "vitest";
import { NETWORK_PASSPHRASES } from "../src/index.js";

// NETWORK_PASSPHRASES is the package's source of truth for the exact passphrase
// strings (see README "Network passphrases and asset format"). These tests lock
// the literal values so a stray edit can't silently break consumers — signing
// helpers, RPC calls, and tests — that depend on byte-exact passphrases.
describe("NETWORK_PASSPHRASES", () => {
  it("pins the exact mainnet passphrase string", () => {
    expect(NETWORK_PASSPHRASES.mainnet).toBe("Public Global Stellar Network ; September 2015");
  });

  it("pins the exact testnet passphrase string", () => {
    expect(NETWORK_PASSPHRASES.testnet).toBe("Test SDF Network ; September 2015");
  });

  it("exposes exactly the supported networks", () => {
    expect(Object.keys(NETWORK_PASSPHRASES).sort()).toEqual(["mainnet", "testnet"]);
  });
});
