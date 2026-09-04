import { describe, it, expect } from "vitest";
import { ClaimStoreFireClaims } from "../../src/triggers/eventTrigger.js";
import { InMemoryClaimStore } from "../../src/idempotency.js";

const TTL = 60_000;

describe("ClaimStoreFireClaims", () => {
  it("wins a window once and refuses the second caller", async () => {
    const store = new InMemoryClaimStore();
    const first = new ClaimStoreFireClaims(store, "worker-a", TTL);
    const second = new ClaimStoreFireClaims(store, "worker-b", TTL);

    await expect(first.claim("w:1000")).resolves.toBe(true);
    await expect(second.claim("w:1000")).resolves.toBe(false);
  });

  it("reports a window claimed by anyone, not just by itself", async () => {
    // The point of adapting onto 18.6's store rather than keeping a private
    // one: a backstop must see the primary's claim, or it double-fires.
    const store = new InMemoryClaimStore();
    const primary = new ClaimStoreFireClaims(store, "primary", TTL);
    const backstop = new ClaimStoreFireClaims(store, "backstop", TTL);

    await expect(backstop.isClaimed("w:1000")).resolves.toBe(false);
    await primary.claim("w:1000");
    await expect(backstop.isClaimed("w:1000")).resolves.toBe(true);
  });

  it("keeps separate windows independent", async () => {
    const store = new InMemoryClaimStore();
    const claims = new ClaimStoreFireClaims(store, "worker-a", TTL);

    await expect(claims.claim("w:1000")).resolves.toBe(true);
    await expect(claims.claim("w:1060")).resolves.toBe(true);
  });

  it("refuses to be constructed without an owner or with a non-positive ttl", () => {
    const store = new InMemoryClaimStore();
    expect(() => new ClaimStoreFireClaims(store, "")).toThrow(/ownerId is required/);
    expect(() => new ClaimStoreFireClaims(store, "worker-a", 0)).toThrow(/must be positive/);
  });
});
