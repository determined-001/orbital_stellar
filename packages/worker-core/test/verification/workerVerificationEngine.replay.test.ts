import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import { registerEventTrigger, type EventTriggerDefinition } from "../../src/index.js";
import type { WorkerDefinition } from "../../src/types.js";
import { WorkerVerificationEngine } from "../../src/verification/WorkerVerificationEngine.js";

/**
 * Reproducibility is the whole product (issue #1049's implementation note 2):
 * a verdict that depends on when or how many times it was computed cannot
 * underwrite anything downstream and cannot be disputed by an operator
 * without a support conversation. This proves it directly - the same inputs,
 * run twice (including with events reshuffled and duplicated the way a
 * re-delivered or reorg-rescanned stream would arrive), produce byte-identical
 * verdicts.
 */

const TARGET_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const CONDITION_CONTRACT = "CDMLFMKMMD7MWZP3FKUBZPVHTUEDLSX4BYGYKH4GCESXYHS3IHQ4EIG4";
const OPERATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function emitted(ledger: number, eventId: string): NormalizedEvent {
  return {
    type: "contract.emitted",
    contractId: CONDITION_CONTRACT,
    topics: ["oracleup"],
    data: {},
    ledger,
    eventId,
    txHash: `tx-${eventId}`,
    inSuccessfulContractCall: true,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

function invoked(ledger: number, txHash: string): NormalizedEvent {
  return {
    type: "contract.invoked",
    contractId: TARGET_CONTRACT,
    function: "disburse",
    args: [],
    ledger,
    txHash,
    inSuccessfulContractCall: true,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

const definition: WorkerDefinition = {
  id: "payroll-w1",
  operator: OPERATOR,
  targetContractId: TARGET_CONTRACT,
  functionName: "disburse",
  buildArgs: () => [],
  network: "testnet",
  trigger: { kind: "event", contractId: CONDITION_CONTRACT, eventTopic: "oracleup" },
};

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

describe("WorkerVerificationEngine replay determinism", () => {
  it("produces identical verdicts across two independent runs over the same range", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [
      emitted(100, "ev-1"),
      emitted(150, "ev-2"),
      emitted(300, "ev-3"), // deliberately past its deadline with no invocation -> missed
    ];
    const invocationEvents = [invoked(105, "tx-a"), invoked(152, "tx-b")];

    const run1 = engine.verifyEventTrigger(
      definition,
      planner(),
      conditionEvents,
      invocationEvents,
      320,
    );
    const run2 = engine.verifyEventTrigger(
      definition,
      planner(),
      conditionEvents,
      invocationEvents,
      320,
    );

    expect(run1).toEqual(run2);
    expect(run1.map((v) => v.status)).toEqual(["fired", "fired", "missed"]);
  });

  it("produces identical verdicts when the same events arrive reshuffled", () => {
    const engine = new WorkerVerificationEngine();
    const ordered = [emitted(100, "ev-1"), emitted(150, "ev-2")];
    const shuffled = [ordered[1]!, ordered[0]!];
    const invocationEvents = [invoked(105, "tx-a"), invoked(152, "tx-b")];

    const fromOrdered = engine.verifyEventTrigger(
      definition,
      planner(),
      ordered,
      invocationEvents,
      200,
    );
    const fromShuffled = engine.verifyEventTrigger(
      definition,
      planner(),
      shuffled,
      invocationEvents,
      200,
    );

    expect(fromOrdered).toEqual(fromShuffled);
  });

  it("produces identical verdicts when a source event is duplicated (re-delivery or reorg re-scan)", () => {
    const engine = new WorkerVerificationEngine();
    const once = [emitted(100, "ev-1")];
    const duplicated = [emitted(100, "ev-1"), emitted(100, "ev-1")];
    const invocationEvents = [invoked(105, "tx-a")];

    const fromOnce = engine.verifyEventTrigger(definition, planner(), once, invocationEvents, 200);
    const fromDuplicated = engine.verifyEventTrigger(
      definition,
      planner(),
      duplicated,
      invocationEvents,
      200,
    );

    expect(fromOnce).toEqual(fromDuplicated);
    expect(fromDuplicated).toHaveLength(1);
  });

  it("is idempotent when replayed against a growing range (checking not-due, then missed, produces the same window identity)", () => {
    const engine = new WorkerVerificationEngine();
    const conditionEvents = [emitted(100, "ev-1")];
    const invocationEvents: NormalizedEvent[] = [];

    const early = engine.verifyEventTrigger(
      definition,
      planner(),
      conditionEvents,
      invocationEvents,
      105,
    );
    const late = engine.verifyEventTrigger(
      definition,
      planner(),
      conditionEvents,
      invocationEvents,
      200,
    );

    expect(early[0]!.windowId).toBe(late[0]!.windowId);
    expect(early[0]!.status).toBe("not-due");
    expect(late[0]!.status).toBe("missed");
  });
});
