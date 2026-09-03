import { describe, it, expect } from "vitest";
import { InMemoryClaimStore, IdempotencyManager, fireKeyToString } from "../src/idempotency";

describe("IdempotencyManager basic behavior", () => {
  it("allows a single owner to claim, submit, and release", async () => {
    const store = new InMemoryClaimStore();
    const chainSeen = false;
    const mgr = new IdempotencyManager(store, async () => chainSeen, 1000);

    const key = { workerId: "w1", windowStartLedger: 10 };
    let ran = false;
    const submitted = await mgr.claimThenSubmit(key, "w1", async () => {
      ran = true;
    });
    expect(submitted).toBe(true);
    expect(ran).toBe(true);

    // Keep the claim until the confirmation-lag TTL expires.
    const rec = await store.get(fireKeyToString(key));
    expect(rec?.owner).toBe("w1");
  });

  it("skips submit if chain already shows execution", async () => {
    const store = new InMemoryClaimStore();
    const chainSeen = true;
    const mgr = new IdempotencyManager(store, async () => chainSeen, 1000);

    const key = { workerId: "w2", windowStartLedger: 20 };
    let ran = false;
    const submitted = await mgr.claimThenSubmit(key, "w2", async () => {
      ran = true;
    });
    expect(submitted).toBe(false);
    expect(ran).toBe(false);
  });

  it("keeps a successful submission claim until the TTL expires", async () => {
    const store = new InMemoryClaimStore();
    const mgr = new IdempotencyManager(store, async () => false, 1000);
    const key = { workerId: "w3", windowStartLedger: 30 };

    await mgr.claimThenSubmit(key, "process-a", async () => undefined);
    const secondAttempt = await mgr.claimThenSubmit(key, "process-b", async () => undefined);

    expect(secondAttempt).toBe(false);
    expect((await store.get(fireKeyToString(key)))?.owner).toBe("process-a");
  });
});
