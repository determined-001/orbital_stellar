import { describe, it, expect } from "vitest";
import { BundledWellKnownClient } from "../src/BundledWellKnownClient.js";

const USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const EURC = "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV";
const AQUA = "CAUIKL3IYGMERDRUN6YSCLWVAKIFG5Q4YJHUKM4S4NJZQIA3BAS6OJPK";
const NATIVE = "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA";
const SAC_INTERFACE_PLACEHOLDER = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

describe("BundledWellKnownClient", () => {
  it("resolves USDC, EURC, AQUA, and the native asset wrapper by contract ID", async () => {
    const client = new BundledWellKnownClient();

    for (const [contractId, expectedName] of [
      [USDC, "USD Coin (USDC)"],
      [EURC, "Euro Coin (EURC)"],
      [AQUA, "Aquarius (AQUA)"],
      [NATIVE, "Native Asset Wrapper (XLM SAC)"],
    ] as const) {
      const spec = await client.getSpec(contractId);
      expect(spec).not.toBeNull();
      expect(spec!.name).toBe(expectedName);
      expect(spec!.contractId).toBe(contractId);
      expect(spec!.functions.length).toBeGreaterThan(0);
    }
  });

  it("does not resolve the sac-interface.json placeholder address", async () => {
    const client = new BundledWellKnownClient();
    expect(await client.getSpec(SAC_INTERFACE_PLACEHOLDER)).toBeNull();
  });

  it("returns null for an unknown contract ID", async () => {
    const client = new BundledWellKnownClient();
    expect(
      await client.getSpec("CUNKNOWN00000000000000000000000000000000000000000000000"),
    ).toBeNull();
  });

  it("caches the bundle across instances (module-level memo) and across repeated calls", async () => {
    const clientA = new BundledWellKnownClient();
    const clientB = new BundledWellKnownClient();
    const specA1 = await clientA.getSpec(USDC);
    const specA2 = await clientA.getSpec(USDC);
    const specB = await clientB.getSpec(USDC);
    expect(specA1).toBe(specA2);
    expect(specA1).toBe(specB);
  });
});
