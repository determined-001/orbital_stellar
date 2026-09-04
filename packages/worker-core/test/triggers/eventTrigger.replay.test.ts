import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import {
  EventTrigger,
  InMemoryFireClaimStore,
  eventIdentity,
  registerEventTrigger,
  type EventTriggerDefinition,
  type FireDecision,
} from "../../src/index.js";
import { TRADE_SIGNAL_REJECTION, compileEventCondition } from "../../src/triggers/predicate.js";

const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const OTHER_CONTRACT = "CDMLFMKMMD7MWZP3FKUBZPVHTUEDLSX4BYGYKH4GCESXYHS3IHQ4EIG4";
const ALICE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const BOB = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBXAF";

/** A `contract.emitted` event. Cast because `timestampDate` is derived by the engine, not by callers. */
function emitted(
  over: Partial<{
    contractId: string;
    topics: string[];
    ledger: number;
    eventId: string;
    txHash: string;
    inSuccessfulContractCall: boolean;
    data: unknown;
  }> = {},
): NormalizedEvent {
  const ledger = over.ledger ?? 100;
  return {
    type: "contract.emitted",
    contractId: over.contractId ?? CONTRACT,
    topics: over.topics ?? ["disburse"],
    data: over.data ?? {},
    ledger,
    eventId: over.eventId ?? `ev-${ledger}`,
    txHash: over.txHash ?? `tx-${ledger}`,
    inSuccessfulContractCall: over.inSuccessfulContractCall ?? true,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

function payment(
  over: Partial<{ ledger: number; eventId: string; from: string; to: string }> = {},
): NormalizedEvent {
  const ledger = over.ledger ?? 100;
  return {
    type: "payment.received",
    from: over.from ?? ALICE,
    to: over.to ?? BOB,
    amount: "10",
    asset: "XLM",
    ledger,
    eventId: over.eventId ?? `pay-${ledger}`,
    txHash: `tx-${ledger}`,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

const definition: EventTriggerDefinition = {
  workerId: "payroll-w1",
  condition: {
    eventTypes: ["contract.emitted"],
    contract: { contractIds: [CONTRACT], topics: [["disburse"]] },
  },
  latencyBoundLedgers: 10,
  activationLedger: 50,
};

function register(over: Partial<EventTriggerDefinition> = {}): EventTrigger {
  const result = registerEventTrigger({ ...definition, ...over });
  if (!result.ok) throw new Error(`registration failed: ${result.errors.join("; ")}`);
  return result.trigger;
}

describe("event-trigger registration gates", () => {
  it("refuses trade-signal conditions with a pointer to W4 and the vault pattern", () => {
    // The implementation note is explicit that this is "a real gate, not a
    // warning. It is how the fixed build order is enforced against a
    // well-meaning contributor."
    const result = registerEventTrigger({
      ...definition,
      condition: { eventTypes: ["offer.created"] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = result.errors.join(" ");
      expect(message).toContain("W4 vault pattern");
      expect(message).toContain("offer.created");
    }
  });

  it("refuses liquidity-pool conditions for the same reason", () => {
    const result = registerEventTrigger({
      ...definition,
      condition: { eventTypes: ["lp.deposited", "lp.withdrawn"] },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain(TRADE_SIGNAL_REJECTION);
  });

  it("requires a declared latency bound", () => {
    // 19.1 measures `late` against this bound; a bound the operator never
    // stated is not one they can be held to.
    for (const bound of [0, -1, 1.5]) {
      const result = registerEventTrigger({ ...definition, latencyBoundLedgers: bound });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.join(" ")).toContain("latencyBoundLedgers");
    }
  });

  it("refuses a condition with no event types rather than matching everything", () => {
    const result = compileEventCondition({ eventTypes: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("every event on the network");
  });

  it("refuses a contract filter on a condition that names no contract event", () => {
    // Otherwise the condition silently never matches, which reads at runtime as
    // "the worker is broken" long after anyone would connect it to this.
    const result = compileEventCondition({
      eventTypes: ["payment.received"],
      contract: { contractIds: [CONTRACT] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("can never match");
  });

  it("reports every problem at once rather than the first", () => {
    const result = registerEventTrigger({
      workerId: "",
      condition: { eventTypes: ["offer.created"] },
      latencyBoundLedgers: 0,
      activationLedger: -1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

describe("event-trigger matching", () => {
  it("matches on type, contract id and topics together", () => {
    const trigger = register();

    expect(trigger.matches(emitted())).toBe(true);
    expect(trigger.matches(emitted({ contractId: OTHER_CONTRACT }))).toBe(false);
    expect(trigger.matches(emitted({ topics: ["other"] }))).toBe(false);
    expect(trigger.matches(payment())).toBe(false);
  });

  it("does not fire on a reverted contract call", () => {
    // A reverted call changed no chain state, so treating it as a condition
    // would fire a worker on something that did not happen.
    const trigger = register();
    expect(trigger.matches(emitted({ inSuccessfulContractCall: false }))).toBe(false);
  });

  it("narrows by participant address across event shapes", () => {
    const trigger = register({
      condition: { eventTypes: ["payment.received"], addresses: [ALICE] },
    });

    expect(trigger.matches(payment({ from: ALICE }))).toBe(true);
    expect(trigger.matches(payment({ from: BOB, to: BOB }))).toBe(false);
  });
});

describe("planning windows", () => {
  it("derives the deadline from the manifest's declared bound", () => {
    const trigger = register();
    const { decisions } = trigger.plan([emitted({ ledger: 100 })]);

    expect(decisions).toHaveLength(1);
    expect(decisions[0].conditionLedger).toBe(100);
    expect(decisions[0].deadlineLedger).toBe(110); // 100 + latencyBoundLedgers
  });

  it("does not manufacture windows before the definition was active", () => {
    // Backfilling over a range that predates registration must not produce a
    // history of misses for a worker that did not exist yet (19.1 §3).
    const trigger = register();
    const { decisions, skipped } = trigger.plan([emitted({ ledger: 40 }), emitted({ ledger: 60 })]);

    expect(decisions.map((d) => d.conditionLedger)).toEqual([60]);
    expect(skipped).toEqual([
      { reason: "before-activation", conditionEventId: "ev-40", conditionLedger: 40 },
    ]);
  });

  it("treats a condition recurring inside an open window as one obligation", () => {
    // A burst of source events is one thing to do, not five. Counting each as
    // its own window fabricates a run of misses from correct behaviour.
    const trigger = register();
    const { decisions, skipped } = trigger.plan([
      emitted({ ledger: 100 }),
      emitted({ ledger: 103 }),
      emitted({ ledger: 108 }),
      emitted({ ledger: 120 }),
    ]);

    expect(decisions.map((d) => d.conditionLedger)).toEqual([100, 120]);
    expect(skipped.map((s) => s.reason)).toEqual(["window-already-open", "window-already-open"]);
  });

  it("skips an event with no ledger rather than guessing one", () => {
    // `ledger` is optional on NormalizedEvent. Estimating it from a timestamp
    // would make window boundaries depend on ledger close time, which is not
    // reproducible.
    const trigger = register();
    const noLedger = { ...(emitted() as unknown as Record<string, unknown>) };
    delete noLedger.ledger;

    const { decisions, skipped } = trigger.plan([noLedger as unknown as NormalizedEvent]);

    expect(decisions).toHaveLength(0);
    expect(skipped[0].reason).toBe("missing-ledger");
  });

  it("skips an event with no stable identity", () => {
    const trigger = register();
    const anonymous = { ...(emitted() as unknown as Record<string, unknown>) };
    delete anonymous.eventId;
    delete anonymous.txHash;

    const { skipped } = trigger.plan([anonymous as unknown as NormalizedEvent]);
    expect(skipped[0].reason).toBe("missing-event-id");
  });

  it("falls back to txHash+ledger when the source gave no event id", () => {
    const withoutEventId = { ...(emitted({ ledger: 77 }) as unknown as Record<string, unknown>) };
    delete withoutEventId.eventId;

    expect(eventIdentity(withoutEventId as unknown as NormalizedEvent)).toBe("tx-77:77");
  });
});

describe("determinism (replay)", () => {
  const range = [
    emitted({ ledger: 60, eventId: "a" }),
    emitted({ ledger: 75, eventId: "b" }),
    emitted({ ledger: 78, eventId: "c" }), // inside b's window
    emitted({ ledger: 95, eventId: "d" }),
    payment({ ledger: 96 }), // does not match
    emitted({ ledger: 120, eventId: "e", contractId: OTHER_CONTRACT }), // wrong contract
  ];

  it("produces identical decisions on a re-run", () => {
    const trigger = register();

    const first = trigger.plan(range);
    const second = trigger.plan(range);

    expect(second).toEqual(first);
    // Serialised equality too: a shared mutable object would satisfy toEqual
    // while still being a different value across a process boundary.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("produces identical decisions from a freshly registered trigger", () => {
    // Registration must not carry state that changes the second answer.
    const a = register().plan(range);
    const b = register().plan(range);
    expect(b).toEqual(a);
  });

  it("is independent of source delivery order", () => {
    // A source that re-delivers a ledger range out of order must not change
    // which windows exist, or 19.1's "should have fired" depends on transport.
    const trigger = register();
    const inOrder = trigger.plan(range);
    const shuffled = trigger.plan([...range].reverse());

    expect(shuffled).toEqual(inOrder);
  });

  it("agrees on shared windows across overlapping ranges", () => {
    // A stronger property than a single-range replay: it catches state that
    // leaks across the boundary of the range being planned.
    const trigger = register();
    const left = trigger.plan(range.slice(0, 4));
    const right = trigger.plan(range.slice(2));

    const byId = (decisions: ReadonlyArray<FireDecision>) =>
      new Map(decisions.map((d) => [d.windowId, d]));
    const leftById = byId(left.decisions);
    const rightById = byId(right.decisions);

    let shared = 0;
    for (const [id, decision] of leftById) {
      const other = rightById.get(id);
      if (!other) continue;
      shared += 1;
      expect(other).toEqual(decision);
    }
    expect(shared).toBeGreaterThan(0);
  });

  it("derives window ids from the source event, not from a counter", () => {
    const trigger = register();
    const { decisions } = trigger.plan(range);

    expect(decisions.map((d) => d.windowId)).toEqual([
      "payroll-w1:a",
      "payroll-w1:b",
      "payroll-w1:d",
    ]);
  });
});

describe("re-delivery and reorg safety", () => {
  it("plans one window when the same event arrives twice in a batch", () => {
    const trigger = register();
    const { decisions, skipped } = trigger.plan([
      emitted({ ledger: 100, eventId: "dup" }),
      emitted({ ledger: 100, eventId: "dup" }),
    ]);

    expect(decisions).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toEqual(["duplicate"]);
  });

  it("does not double-fire when a ledger is re-scanned after a reorg", async () => {
    // Two separate planning passes over an overlapping range — what a reorg
    // re-scan actually looks like. Planning is deterministic, so both produce
    // the window; 18.6's claim store is what makes only one fire.
    const trigger = register();
    const store = new InMemoryFireClaimStore();

    const firstPass = trigger.plan([emitted({ ledger: 100, eventId: "x" })]);
    const wonFirst = await trigger.claimDecisions(firstPass.decisions, store);

    const rescan = trigger.plan([emitted({ ledger: 100, eventId: "x" })]);
    const wonSecond = await trigger.claimDecisions(rescan.decisions, store);

    expect(wonFirst).toHaveLength(1);
    expect(wonSecond).toHaveLength(0);
    expect(rescan.decisions).toEqual(firstPass.decisions);
  });

  it("lets exactly one of two concurrent claimants win a window", async () => {
    // The backstop (21.1) and the primary converge on the same window id, which
    // is what stops a backstop double-firing against a primary that fired late.
    const trigger = register();
    const store = new InMemoryFireClaimStore();
    const { decisions } = trigger.plan([emitted({ ledger: 100, eventId: "race" })]);

    const [primary, backstop] = await Promise.all([
      trigger.claimDecisions(decisions, store),
      trigger.claimDecisions(decisions, store),
    ]);

    expect(primary.length + backstop.length).toBe(1);
  });
});

describe("verification consumes the same windows (19.1)", () => {
  it("emits every field a verdict needs, and no verdict of its own", () => {
    // 19.1 scores event triggers "with no new code path": planning states what
    // was owed, verification states what happened, and the two stay apart so a
    // verdict can be recomputed from chain data alone.
    const trigger = register();
    const [decision] = trigger.plan([emitted({ ledger: 100, eventId: "w" })]).decisions;

    expect(Object.keys(decision).sort()).toEqual([
      "conditionEventId",
      "conditionLedger",
      "deadlineLedger",
      "windowId",
      "workerId",
    ]);
    expect(decision).not.toHaveProperty("verdict");
    expect(decision).not.toHaveProperty("firedLedger");
  });
});
