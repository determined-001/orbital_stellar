import { describe, it, expect } from "vitest";
import { EventEngine } from "../src/EventEngine.js";

describe("EventEngine.awaitContractSubscriptionActive", () => {
  it("resolves when a poll includes the requested topics", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C1", topics: ["t1", "t2"] },
      { timeoutMs: 1000 },
    );

    // Simulate a poll that includes the requested topics (order differs)
    engine.notifyContractPolled("C1", ["t2", "t3", "t1"]);

    await expect(p).resolves.toBeUndefined();
  });

  it("resolves when a poll has no topic restriction (covers all)", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C2", topics: ["alpha"] },
      { timeoutMs: 1000 },
    );

    // Simulate a poll with no topics (covers all topics)
    engine.notifyContractPolled("C2", undefined);

    await expect(p).resolves.toBeUndefined();
  });

  it("does not resolve if polled topics do not include requested topics", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C3", topics: ["x", "y"] },
      { timeoutMs: 50 },
    );

    // Simulate a poll that doesn't include all requested topics
    engine.notifyContractPolled("C3", ["x"]);

    await expect(p).rejects.toThrow("awaitContractSubscriptionActive: timeout");
  });

  it("resolves immediately when no topics requested", async () => {
    const engine = new EventEngine({ network: "testnet" });

    const p = engine.awaitContractSubscriptionActive(
      { contractId: "C4" },
      { timeoutMs: 1000 },
    );

    // Any poll for the contract should satisfy
    engine.notifyContractPolled("C4", ["whatever"]);

    await expect(p).resolves.toBeUndefined();
  });
});
