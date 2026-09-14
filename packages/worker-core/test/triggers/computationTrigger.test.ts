import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import {
  registerComputationTrigger,
  type ComputationTriggerDefinition,
  type ComputationConditionOccurrence,
} from "../../src/triggers/computationTrigger.js";
import {
  signComputationAttestation,
  type ComputationAttestation,
} from "../../src/triggers/attestation.js";
import { WorkerVerificationEngine } from "../../src/verification/WorkerVerificationEngine.js";
import type { WorkerDefinition } from "../../src/types.js";

const TARGET_CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const OPERATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const SOURCE = Keypair.random();

function invoked(
  ledger: number,
  over: Partial<{ inSuccessfulContractCall: boolean }> = {},
): NormalizedEvent {
  return {
    type: "contract.invoked",
    contractId: TARGET_CONTRACT,
    function: "disburse",
    args: [],
    ledger,
    txHash: `tx-${ledger}`,
    inSuccessfulContractCall: over.inSuccessfulContractCall ?? true,
    timestamp: "2026-01-01T00:00:00.000Z",
  } as unknown as NormalizedEvent;
}

const workerDefinition: WorkerDefinition = {
  id: "payroll-w1",
  operator: OPERATOR,
  targetContractId: TARGET_CONTRACT,
  functionName: "disburse",
  buildArgs: () => [],
  network: "testnet",
  trigger: { kind: "computation", description: "oracle resolution" },
};

const triggerDefinition: ComputationTriggerDefinition = {
  workerId: "payroll-w1",
  conditionId: "oracle-resolution",
  declaredSources: [SOURCE.publicKey()],
  latencyBoundLedgers: 10,
  activationLedger: 0,
};

function planner() {
  const result = registerComputationTrigger(triggerDefinition);
  if (!result.ok) throw new Error(`registration failed: ${result.errors.join("; ")}`);
  return result.trigger;
}

function attestedOccurrence(
  occurrenceId: string,
  ledger: number,
  over: Partial<ComputationAttestation> = {},
): ComputationConditionOccurrence {
  const windowId = `payroll-w1:c:${occurrenceId}`;
  const document: ComputationAttestation = {
    attester: SOURCE.publicKey(),
    workerId: "payroll-w1",
    windowId,
    conditionId: "oracle-resolution",
    observedAt: "2026-01-01T00:00:00Z",
    result: { price: "1.23" },
    resultHash: "a".repeat(64),
    ...over,
  };
  return {
    occurrenceId,
    ledger,
    attestation: signComputationAttestation(document, SOURCE.secret()),
  };
}

describe("registerComputationTrigger", () => {
  it("refuses a definition with no declared sources", () => {
    const result = registerComputationTrigger({ ...triggerDefinition, declaredSources: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/declaredSources/);
  });

  it("refuses a non-positive latencyBoundLedgers", () => {
    const result = registerComputationTrigger({ ...triggerDefinition, latencyBoundLedgers: 0 });
    expect(result.ok).toBe(false);
  });
});

describe("ComputationTriggerPlanner.plan", () => {
  it("opens a real window for a valid, correctly-bound attestation", () => {
    const { windows, unverifiable } = planner().plan([attestedOccurrence("occ-1", 100)]);
    expect(unverifiable).toEqual([]);
    expect(windows).toEqual([
      {
        windowId: "payroll-w1:c:occ-1",
        workerId: "payroll-w1",
        conditionLedger: 100,
        deadlineLedger: 110,
      },
    ]);
  });

  it("resolves to unverifiable (no-attestation-equivalent: attestation-unretrievable) when the attestation is null", () => {
    const { windows, unverifiable } = planner().plan([
      { occurrenceId: "occ-1", ledger: 100, attestation: null },
    ]);
    expect(windows).toEqual([]);
    expect(unverifiable).toMatchObject([
      { reason: "attestation-unretrievable", conditionLedger: 100, deadlineLedger: 110 },
    ]);
  });

  it("resolves to unverifiable (attestation-invalid) for a signature from an undeclared source", () => {
    const impostor = Keypair.random();
    const doc: ComputationAttestation = {
      attester: impostor.publicKey(),
      workerId: "payroll-w1",
      windowId: "payroll-w1:c:occ-1",
      conditionId: "oracle-resolution",
      observedAt: "2026-01-01T00:00:00Z",
      result: {},
      resultHash: "a".repeat(64),
    };
    const occurrence: ComputationConditionOccurrence = {
      occurrenceId: "occ-1",
      ledger: 100,
      attestation: signComputationAttestation(doc, impostor.secret()),
    };

    const { windows, unverifiable } = planner().plan([occurrence]);
    expect(windows).toEqual([]);
    expect(unverifiable).toMatchObject([{ reason: "attestation-invalid" }]);
  });

  it("resolves to unverifiable (attestation-window-mismatch) for a replayed attestation", () => {
    // Signed for a different occurrence's window, then presented against occ-1.
    const replayed = attestedOccurrence("occ-2", 100);
    const misplaced: ComputationConditionOccurrence = { ...replayed, occurrenceId: "occ-1" };

    const { unverifiable } = planner().plan([misplaced]);
    expect(unverifiable).toMatchObject([{ reason: "attestation-window-mismatch" }]);
  });

  it("skips an occurrence before the definition's activation ledger", () => {
    const result = registerComputationTrigger({ ...triggerDefinition, activationLedger: 50 });
    if (!result.ok) throw new Error("registration failed");
    const { windows, unverifiable } = result.trigger.plan([attestedOccurrence("occ-1", 10)]);
    expect(windows).toEqual([]);
    expect(unverifiable).toEqual([]);
  });

  it("is deterministic: duplicate occurrenceIds resolve once, order does not matter", () => {
    const a = attestedOccurrence("occ-1", 100);
    const b = attestedOccurrence("occ-2", 50);
    const once = planner().plan([a, b]);
    const reordered = planner().plan([b, a, { ...a }]);
    expect(reordered.windows).toEqual(once.windows);
  });
});

describe("WorkerVerificationEngine.verifyComputationTrigger", () => {
  it("verdict: fired - invocation lands within the attested window's bound", () => {
    const engine = new WorkerVerificationEngine();
    const verdicts = engine.verifyComputationTrigger(
      workerDefinition,
      planner(),
      [attestedOccurrence("occ-1", 100)],
      [invoked(105)],
      120,
    );
    expect(verdicts).toMatchObject([
      { status: "fired", conditionLedger: 100, deadlineLedger: 110 },
    ]);
  });

  it("verdict: late - invocation lands after the bound", () => {
    const engine = new WorkerVerificationEngine();
    const verdicts = engine.verifyComputationTrigger(
      workerDefinition,
      planner(),
      [attestedOccurrence("occ-1", 100)],
      [invoked(115)],
      120,
    );
    expect(verdicts).toMatchObject([{ status: "late", latencyLedgers: 5 }]);
  });

  it("verdict: missed - a valid, bound attestation exists but no invocation ever lands", () => {
    const engine = new WorkerVerificationEngine();
    const verdicts = engine.verifyComputationTrigger(
      workerDefinition,
      planner(),
      [attestedOccurrence("occ-1", 100)],
      [],
      200,
    );
    expect(verdicts).toMatchObject([{ status: "missed" }]);
  });

  it("verdict: unverifiable - excluded from being scored as either a success or a miss", () => {
    const engine = new WorkerVerificationEngine();
    const verdicts = engine.verifyComputationTrigger(
      workerDefinition,
      planner(),
      [{ occurrenceId: "occ-1", ledger: 100, attestation: null }],
      [],
      200,
    );
    expect(verdicts).toMatchObject([
      { status: "unverifiable", reason: "attestation-unretrievable" },
    ]);
  });

  it("throws for a mismatched trigger kind", () => {
    const engine = new WorkerVerificationEngine();
    const timeDefinition: WorkerDefinition = {
      ...workerDefinition,
      trigger: { kind: "time", schedule: { kind: "interval", everyMs: 1000, timezone: "UTC" } },
    };
    expect(() => engine.verifyComputationTrigger(timeDefinition, planner(), [], [], 0)).toThrow(
      /verifyComputationTrigger called with a "time" trigger/,
    );
  });

  it("produces identical verdicts across two independent runs (reproducibility)", () => {
    const engine = new WorkerVerificationEngine();
    const occurrences = [attestedOccurrence("occ-1", 100), attestedOccurrence("occ-2", 150)];
    const invocationEvents = [invoked(105), invoked(155)];

    const run1 = engine.verifyComputationTrigger(
      workerDefinition,
      planner(),
      occurrences,
      invocationEvents,
      200,
    );
    const run2 = engine.verifyComputationTrigger(
      workerDefinition,
      planner(),
      occurrences,
      invocationEvents,
      200,
    );

    expect(run1).toEqual(run2);
  });
});
