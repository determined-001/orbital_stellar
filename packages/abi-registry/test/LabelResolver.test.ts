import { describe, it, expect } from "vitest";
import { LabelResolver } from "../src/LabelResolver.js";

const USDC_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const EURC_ID = "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV";
const AQUA_ID = "CAUIKL3IYGMERDRUN5QQVPKPLZTRNVXV27LFCWQIRNOHSNGB3ZXAEFBX";
const UNKNOWN_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

describe("LabelResolver", () => {
  describe("when enabled", () => {
    const resolver = new LabelResolver({ enabled: true });

    it("resolves USDC contract to Circle issuer label", () => {
      const label = resolver.resolve(USDC_ID);
      expect(label).not.toBeNull();
      expect(label!.label).toBe("Circle (USDC Issuer)");
      expect(label!.entityType).toBe("issuer");
      expect(label!.confidence).toBe(1.0);
    });

    it("resolves EURC contract to Circle issuer label", () => {
      const label = resolver.resolve(EURC_ID);
      expect(label).not.toBeNull();
      expect(label!.label).toBe("Circle (EURC Issuer)");
      expect(label!.entityType).toBe("issuer");
      expect(label!.confidence).toBe(1.0);
    });

    it("resolves AQUA contract to Aquarius issuer label", () => {
      const label = resolver.resolve(AQUA_ID);
      expect(label).not.toBeNull();
      expect(label!.label).toBe("Aquarius DAO (AQUA Issuer)");
      expect(label!.entityType).toBe("issuer");
      expect(label!.confidence).toBe(1.0);
    });

    it("returns null for an unknown contract ID", () => {
      expect(resolver.resolve(UNKNOWN_ID)).toBeNull();
    });

    it("returns null for a malformed contract ID", () => {
      expect(resolver.resolve("not-a-valid-contract-id")).toBeNull();
    });

    it("resolves multiple contract IDs via resolveAll", () => {
      const labels = resolver.resolveAll([USDC_ID, EURC_ID, UNKNOWN_ID]);
      expect(labels.size).toBe(2);
      expect(labels.get(USDC_ID)?.label).toBe("Circle (USDC Issuer)");
      expect(labels.get(EURC_ID)?.label).toBe("Circle (EURC Issuer)");
      expect(labels.has(UNKNOWN_ID)).toBe(false);
    });

    it("caches label records across instances (module-level memo)", () => {
      const resolverA = new LabelResolver({ enabled: true });
      const resolverB = new LabelResolver({ enabled: true });
      const labelA1 = resolverA.resolve(USDC_ID);
      const labelA2 = resolverA.resolve(USDC_ID);
      const labelB = resolverB.resolve(USDC_ID);
      // ResolvedLabel objects are created fresh each call, but values match
      expect(labelA1).toStrictEqual(labelA2);
      expect(labelA1).toStrictEqual(labelB);
    });
  });

  describe("when disabled (default)", () => {
    const resolver = new LabelResolver();

    it("returns null for any contract ID", () => {
      expect(resolver.resolve(USDC_ID)).toBeNull();
      expect(resolver.resolve(UNKNOWN_ID)).toBeNull();
    });

    it("returns empty map for resolveAll", () => {
      const labels = resolver.resolveAll([USDC_ID, EURC_ID]);
      expect(labels.size).toBe(0);
    });
  });

  describe("when explicitly disabled", () => {
    const resolver = new LabelResolver({ enabled: false });

    it("returns null for any contract ID", () => {
      expect(resolver.resolve(USDC_ID)).toBeNull();
    });

    it("returns empty map for resolveAll", () => {
      const labels = resolver.resolveAll([USDC_ID, EURC_ID]);
      expect(labels.size).toBe(0);
    });
  });
});
