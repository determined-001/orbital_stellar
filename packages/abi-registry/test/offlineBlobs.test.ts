import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { buildWellKnownOfflineBlobs } from "../src/offlineBlobs.js";
import { canonicalizeSpec } from "../src/spec.js";
import type { ContractSpec } from "../src/spec.js";

/**
 * These hashes are what `scripts/seed-well-known.ts` actually filed on the
 * testnet registry on 2026-09-06. They are the point of the whole mechanism:
 * a locally rebuilt blob is only usable if it hashes to what the chain says,
 * and this test is what proves the rebuild still does.
 *
 * If a well-known spec or the pointer base URL changes, these must be
 * regenerated *and* the registry republished - a blob that no longer matches
 * simply falls back to fetching the pointer, silently losing the offline path.
 */
const ON_CHAIN_HASHES: ReadonlyArray<readonly [string, string]> = [
  ["USDC", "5300e7f2f1d52c91cf978326a4b49d7a9f0e15ce85b5b7c72d27cd2e78d83790"],
  ["EURC", "d459841519bc4118a4f1d5fdc1607652daaa59e1f11f1be34baab05b1a79bc08"],
  ["AQUA", "17759921f03853a566cbfe60cff3eb17a350c306df20ab97210c41880021a32b"],
  ["XLM SAC", "4608bdd4aff7fd14ce4633d41f47d4d8e461bb94edc8d000882a2069981dd1c4"],
];

describe("buildWellKnownOfflineBlobs", () => {
  const blobs = buildWellKnownOfflineBlobs();

  it("rebuilds one blob per bundled well-known spec", () => {
    expect(blobs.size).toBe(4);
  });

  it.each(ON_CHAIN_HASHES)("reproduces the hash the registry holds for %s", (_name, hash) => {
    expect(blobs.has(hash)).toBe(true);
  });

  it("keys every blob by its own canonical hash", () => {
    // The invariant the client relies on: a lookup hit means the bytes really
    // are the bytes that hash names, so no verification is being skipped.
    for (const [hash, text] of blobs) {
      const spec = JSON.parse(text) as ContractSpec;
      expect(createHash("sha256").update(canonicalizeSpec(spec)).digest("hex")).toBe(hash);
    }
  });

  it("produces nothing usable under a different pointer base", () => {
    // The pointer is part of the spec, so it is part of the hash. A blob built
    // for a different host must not satisfy a record published for this one.
    const other = buildWellKnownOfflineBlobs("https://example.invalid/specs");
    for (const [, hash] of ON_CHAIN_HASHES) expect(other.has(hash)).toBe(false);
  });
});
