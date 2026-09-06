import { describe, it, expect } from "vitest";
import { createDefaultAbiRegistryClient } from "../src/createDefaultAbiRegistryClient.js";
import { BundledWellKnownClient } from "../src/BundledWellKnownClient.js";
import { ChainedAbiRegistryClient } from "../src/ChainedAbiRegistryClient.js";
import { ORBITAL_REGISTRY_TESTNET_CONTRACT_ID } from "../src/registryConstants.js";

const USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

/**
 * The registry contract is deployed and seeded (2026-09-06), so the default
 * chain now carries a live on-chain link. That changes what can be asserted
 * here without a network: a *hit* in an earlier link never reaches the chain
 * and stays offline, but a *miss* falls through to it by design.
 *
 * The miss case is therefore exercised against an explicitly composed chain
 * rather than the default one. Resolution against the live contract is covered
 * end to end by the seeding script's `--dry-run` and by reading specs back on
 * testnet, which is where it belongs - a unit test that silently depends on
 * testnet being up is a flaky test wearing a unit test's clothes.
 */
describe("createDefaultAbiRegistryClient", () => {
  it("resolves a bundled well-known spec without reaching the network", async () => {
    // Bundled sits ahead of the on-chain link, so this returns before any RPC.
    const spec = await createDefaultAbiRegistryClient().getSpec(USDC);
    expect(spec).not.toBeNull();
    expect((spec as { name: string }).name).toBe("USD Coin (USDC)");
  });

  it("ships a populated on-chain link by default", () => {
    // Guards the deployment wiring. If a redeploy blanks this constant, the
    // default chain silently degrades to bundled-only and every contract that
    // is not one of the four bundled specs resolves to null - a failure that
    // looks exactly like "not registered".
    expect(ORBITAL_REGISTRY_TESTNET_CONTRACT_ID).not.toBe("");
  });
});

describe("ChainedAbiRegistryClient", () => {
  it("returns null when no link in the chain has the contract", async () => {
    const chain = new ChainedAbiRegistryClient([new BundledWellKnownClient()]);
    expect(
      await chain.getSpec("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"),
    ).toBeNull();
  });
});
