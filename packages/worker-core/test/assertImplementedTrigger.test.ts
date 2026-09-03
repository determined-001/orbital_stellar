import { describe, it, expect } from "vitest";
import {
  assertImplementedTrigger,
  TriggerNotImplementedError,
  type Trigger,
} from "../src/index.js";

describe("assertImplementedTrigger", () => {
  it("does not throw for a time trigger", () => {
    const trigger: Trigger = {
      kind: "time",
      schedule: { kind: "interval", everyMs: 60_000, timezone: "UTC" },
    };
    expect(() => assertImplementedTrigger(trigger)).not.toThrow();
  });

  it("rejects an event trigger with a clear W2 message", () => {
    const trigger: Trigger = {
      kind: "event",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      eventTopic: "payment.received",
    };

    let thrown: unknown;
    try {
      assertImplementedTrigger(trigger);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TriggerNotImplementedError);
    expect((thrown as TriggerNotImplementedError).kind).toBe("event");
    expect((thrown as Error).message).toContain("not implemented until W2");
  });

  it("rejects a computation trigger with a clear W2 message", () => {
    const trigger: Trigger = {
      kind: "computation",
      description: "off-chain price oracle deviation",
    };

    let thrown: unknown;
    try {
      assertImplementedTrigger(trigger);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TriggerNotImplementedError);
    expect((thrown as TriggerNotImplementedError).kind).toBe("computation");
    expect((thrown as Error).message).toContain("not implemented until W2");
  });

  it("names the offending kind, not a generic message", () => {
    const eventTrigger: Trigger = {
      kind: "event",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      eventTopic: "payment.received",
    };
    const computationTrigger: Trigger = {
      kind: "computation",
      description: "off-chain price oracle deviation",
    };

    expect(() => assertImplementedTrigger(eventTrigger)).toThrowError(/"event"/);
    expect(() => assertImplementedTrigger(computationTrigger)).toThrowError(/"computation"/);
  });
});
