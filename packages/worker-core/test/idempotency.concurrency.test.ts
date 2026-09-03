import { describe, it, expect } from "vitest";
import { InMemoryClaimStore, IdempotencyManager } from "../src/idempotency";

describe("Idempotency concurrency", () => {
  it("only one concurrent claimant performs the submission", async () => {
    const store = new InMemoryClaimStore();
    let chainSeen = false;
    const submitCalls: string[] = [];

    const mgrA = new IdempotencyManager(store, async () => chainSeen, 1000);
    const mgrB = new IdempotencyManager(store, async () => chainSeen, 1000);

    const key = { workerId: "concurrent", windowStartLedger: 42 };

    // Run both claim attempts in parallel
    await Promise.all([
      mgrA.claimThenSubmit(key, "process-a", async () => {
        submitCalls.push("A");
        // simulate some work
        await new Promise((r) => setTimeout(r, 50));
        chainSeen = true;
      }),
      mgrB.claimThenSubmit(key, "process-b", async () => {
        submitCalls.push("B");
        await new Promise((r) => setTimeout(r, 50));
        chainSeen = true;
      }),
    ]);

    // Exactly one submit should have happened
    expect(submitCalls.length).toBe(1);
  });
});
