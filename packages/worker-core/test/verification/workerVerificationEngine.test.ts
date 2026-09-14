import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import { registerEventTrigger, type EventTriggerDefinition } from "../../src/index.js";
import type { WorkerDefinition } from "../../src/types.js";
import {
  WorkerVerificationEngine,
  ArrayLedgerCloseTimeIndex,
} from "../../src/verification/WorkerVerificationEngine.js";

const TARGET_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const CONDITION_CONTRACT = "CDMLFMKMMD7MWZP3FKUBZPVHTUEDLSX4BYGYKH4GCESXYHS3IHQ4EIG4";
const OPERATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function emitted(
  over: Partial<{
    contractId: string;
    topics: string[];
    ledger: number;
    eventId: string;
    inSuccessfulContractCall: boolean;
  }> = {},
): NormalizedEvent {
  const ledger = over.ledger ?? 100;
  return {
    type: "contract.emitted",
    contractId: over.contractId ?? CONDITION_CONTRACT,
    topics: over.topics ?? ["oracleup"],
    data: {},
    ledger,
    eventId: over.eventId ?? `ev-${ledger}`,
    txHash: `tx-${ledger}`,
    inSuccessfulContractCall: over.inSuccessfulContractCall ?? true,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

function invoked(
  over: Partial<{
    contractId: string;
    function: string;
    ledger: number;
    txHash: string;
    inSuccessfulContractCall: boolean;
  }> = {},
): NormalizedEvent {
  const ledger = over.ledger ?? 100;
  return {
    type: "contract.invoked",
    contractId: over.contractId ?? TARGET_CONTRACT,
    function: over.function ?? "disburse",
    args: [],
    ledger,
    txHash: over.txHash ?? `tx-invoke-${ledger}`,
    inSuccessfulContractCall: over.inSuccessfulContractCall ?? true,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

function eventDefinition(): WorkerDefinition {
  return {
    id: "payroll-w1",
    operator: OPERATOR,
    targetContractId: TARGET_CONTRACT,
    functionName: "disburse",
    buildArgs: () => [],
    network: "testnet",
    trigger: {
      kind: "event",
      contractId: CONDITION_CONTRACT,
      eventTopic: "oracleup",
    },
  };
}

function timeDefinition(): WorkerDefinition {
  return {
    id: "payroll-w1",
    operator: OPERATOR,
    targetContractId: TARGET_CONTRACT,
    functionName: "disburse",
    buildArgs: () => [],
    network: "testnet",
    trigger: {
      kind: "time",
      schedule: { kind: "interval", everyMs: 5 * 60 * 1000, timezone: "UTC" },
    },
  };
}

const eventTriggerDef: EventTriggerDefinition = {
  workerId: "payroll-w1",
  condition: {
    eventTypes: ["contract.emitted"],
    contract: { contractIds: [CONDITION_CONTRACT], topics: [["oracleup"]] },
  },
  latencyBoundLedgers: 10,
  activationLedger: 0,
};

function planner() {
  const result = registerEventTrigger(eventTriggerDef);
  if (!result.ok) throw new Error(`registration failed: ${result.errors.join("; ")}`);
  return result.trigger;
}

describe("WorkerVerificationEngine - event-triggered workers", () => {
  it("verdict: fired - a matching invocation lands within the latency bound", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents = [invoked({ ledger: 105 })];

    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      120,
    );

    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({
      status: "fired",
      conditionLedger: 100,
      deadlineLedger: 110,
      invocationLedger: 105,
    });
  });

  it("verdict: late - the invocation lands after the deadline, with measured latency", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents = [invoked({ ledger: 115 })];

    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      120,
    );

    expect(verdicts[0]).toMatchObject({
      status: "late",
      deadlineLedger: 110,
      invocationLedger: 115,
      latencyLedgers: 5,
    });
  });

  it("verdict: missed - the deadline passed within the queried range with no matching invocation", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents: NormalizedEvent[] = [];

    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      200,
    );

    expect(verdicts[0]).toMatchObject({ status: "missed" });
    expect(verdicts[0].invocationLedger).toBeUndefined();
  });

  it("verdict: pending - the deadline has not been reached within the queried range yet", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents: NormalizedEvent[] = [];

    // deadlineLedger is 110; this run has only observed up to ledger 105.
    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      105,
    );

    expect(verdicts[0]).toMatchObject({ status: "pending" });
  });

  it("verdict: pending - the deadline has just cleared but is still within the verification horizon", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents: NormalizedEvent[] = [];

    // deadlineLedger is 110; toLedger is 115, past the deadline, but the
    // horizon (10) means anything within 10 ledgers of the deadline stays
    // pending rather than resolving to missed.
    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      115,
      10,
    );

    expect(verdicts[0]).toMatchObject({ status: "pending" });
  });

  it("verdict: not-due (reason: rejected-early-call) - a rejected invocation attempt is evidence of liveness, not a miss", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    // A failed attempt within the window - a contract legitimately rejecting
    // a too-early call. Past the deadline (toLedger 200), with no successful
    // invocation ever landing, this must resolve to not-due, not missed.
    const invocationEvents = [invoked({ ledger: 103, inSuccessfulContractCall: false })];

    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      200,
    );

    expect(verdicts[0]).toMatchObject({ status: "not-due", reason: "rejected-early-call" });
  });

  it("ignores an invocation of a different contract or function", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents = [
      invoked({
        ledger: 102,
        contractId: "COTHER0000000000000000000000000000000000000000000000000",
      }),
      invoked({ ledger: 103, function: "not_disburse" }),
    ];

    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      200,
    );

    expect(verdicts[0].status).toBe("missed");
  });

  it("picks the earliest matching invocation when more than one lands in range", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted({ ledger: 100 })];
    const invocationEvents = [invoked({ ledger: 108 }), invoked({ ledger: 103 })];

    const verdicts = engine.verifyEventTrigger(
      eventDefinition(),
      planner(),
      conditionEvents,
      invocationEvents,
      120,
    );

    expect(verdicts[0].invocationLedger).toBe(103);
  });
});

describe("WorkerVerificationEngine - time-triggered workers", () => {
  it("verdict: fired - the invocation lands within the bound of a due time", () => {
    const engine = new WorkerVerificationEngine();
    // Every 5 minutes starting at the epoch of ledger 1's close time.
    const closeTimes = new ArrayLedgerCloseTimeIndex([
      { ledger: 1, closeTime: new Date("2026-01-01T00:00:00Z") },
      { ledger: 2, closeTime: new Date("2026-01-01T00:05:00Z") },
      { ledger: 3, closeTime: new Date("2026-01-01T00:10:00Z") },
    ]);
    const invocationEvents = [invoked({ ledger: 2, function: "disburse" })];

    const verdicts = engine.verifyTimeTrigger(
      timeDefinition(),
      invocationEvents,
      { fromLedger: 1, toLedger: 3 },
      { latencyBoundLedgers: 1, ledgerCloseTimes: closeTimes },
    );

    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.some((v) => v.status === "fired")).toBe(true);
  });

  it("throws for a mismatched trigger kind", () => {
    const engine = new WorkerVerificationEngine();
    const closeTimes = new ArrayLedgerCloseTimeIndex([]);
    expect(() =>
      engine.verifyTimeTrigger(
        eventDefinition(),
        [],
        { fromLedger: 1, toLedger: 2 },
        {
          latencyBoundLedgers: 1,
          ledgerCloseTimes: closeTimes,
        },
      ),
    ).toThrow(/verifyTimeTrigger called with a "event" trigger/);
  });
});

describe("WorkerVerificationEngine - computation-triggered workers", () => {
  it("throws for a mismatched trigger kind", () => {
    const engine = new WorkerVerificationEngine();
    const definition: WorkerDefinition = {
      id: "w1",
      operator: OPERATOR,
      targetContractId: TARGET_CONTRACT,
      functionName: "disburse",
      buildArgs: () => [],
      network: "testnet",
      trigger: { kind: "time", schedule: { kind: "interval", everyMs: 1000, timezone: "UTC" } },
    };

    // @ts-expect-error - deliberately passing null/[] for the computation-specific
    // params this branch never reaches, to isolate the kind guard itself.
    expect(() => engine.verifyComputationTrigger(definition, null, [], [], 0)).toThrow(
      /verifyComputationTrigger called with a "time" trigger/,
    );
  });
});

// Full fired/late/missed/unverifiable coverage for computation-triggered
// workers lives in computationTrigger.test.ts, alongside the planner and
// attestation-verification tests it depends on.
