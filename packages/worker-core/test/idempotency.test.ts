import { describe, it, expect } from "vitest";
import { InMemoryClaimStore, IdempotencyManager, fireKeyToString } from "../src/idempotency";

describe("IdempotencyManager basic behavior", () => {
  it("allows a single owner to claim, submit, and release", async () => {
    const store = new InMemoryClaimStore();
    let chainSeen = false;
    const mgr = new IdempotencyManager(store, async () => chainSeen, 1000);

    const key = { workerId: "w1", windowStartLedger: 10 };
    let ran = false;
    const submitted = await mgr.claimThenSubmit(key, "w1", async () => {
      ran = true;
    });
    expect(submitted).toBe(true);
    expect(ran).toBe(true);

    // After submission the claim should be released
    const rec = await store.get(fireKeyToString(key));
    expect(rec).toBeNull();
  });

  it("skips submit if chain already shows execution", async () => {
    const store = new InMemoryClaimStore();
    let chainSeen = true;
    const mgr = new IdempotencyManager(store, async () => chainSeen, 1000);

    const key = { workerId: "w2", windowStartLedger: 20 };
    let ran = false;
    const submitted = await mgr.claimThenSubmit(key, "w2", async () => {
      ran = true;
    });
    expect(submitted).toBe(false);
    expect(ran).toBe(false);
  });
});
