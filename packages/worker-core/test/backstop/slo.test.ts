import { describe, it, expect, vi } from "vitest";
import { InMemoryVerdictStore } from "@orbital-stellar/abi-registry";
import {
  ORBITAL_BACKSTOP_OPERATOR_ID,
  BackstopSloError,
  evaluateBackstopSlo,
  type BackstopSloBounds,
  type OperatorScorer,
  type WorkerVerdictStore,
  type WorkerWindowVerdict,
  type WorkerWindowStatus,
} from "../../src/backstop/slo.js";

const MAX_STROOPS = 9223372036854775807n;

const BOUNDS: BackstopSloBounds = {
  latencyBoundLedgers: 12,
  gracePeriodLedgers: 6,
  xlmFloatMinStroops: 1_000_000n,
  monitoringLagGraceLedgers: 10,
};

function memoryStore(seed: WorkerWindowVerdict[] = []): WorkerVerdictStore {
  const rows = [...seed];
  return {
    async record(verdict) {
      rows.push(verdict);
    },
    async getByOperator(operatorId) {
      return rows.filter((row) => row.operatorId === operatorId);
    },
  };
}

function window(status: WorkerWindowStatus, windowId = "w1"): WorkerWindowVerdict {
  return {
    workerId: "backstop-1",
    operatorId: ORBITAL_BACKSTOP_OPERATOR_ID,
    windowId,
    status,
    ledgerStart: 100,
    ledgerEnd: 110,
  };
}

function recordingScorer(calls: string[]): OperatorScorer {
  return {
    async score(_store, operatorId) {
      calls.push(operatorId);
      return { operatorId, formulaVersion: "test-1", kind: "scored" };
    },
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  const scored: string[] = [];
  const alertTransition = vi.fn(async () => {});
  return {
    scored,
    alertTransition,
    input: {
      windows: [window("fired")],
      bounds: BOUNDS,
      xlmFloatStroops: 1_000_000n,
      chainHeadLedger: 200,
      lastProcessedLedger: 190,
      store: memoryStore(),
      scorer: recordingScorer(scored),
      alertManager: { alertTransition },
      sloVerdictStore: new InMemoryVerdictStore(),
      ...overrides,
    },
  };
}

describe("evaluateBackstopSlo", () => {
  it("is a function", () => {
    expect(typeof evaluateBackstopSlo).toBe("function");
  });

  it("records Orbital windows in the same store as an external operator", async () => {
    const store = memoryStore([
      {
        workerId: "ext-1",
        operatorId: "ext-op",
        windowId: "ew1",
        status: "fired",
        ledgerStart: 90,
        ledgerEnd: 95,
      },
    ]);
    const { input } = deps({ store, windows: [window("fired", "ow1")] });
    await evaluateBackstopSlo(input);

    const orbital = await store.getByOperator(ORBITAL_BACKSTOP_OPERATOR_ID);
    const external = await store.getByOperator("ext-op");
    expect(orbital).toHaveLength(1);
    expect(orbital[0]?.windowId).toBe("ow1");
    expect(external).toHaveLength(1);
    expect(external[0]?.operatorId).toBe("ext-op");
  });

  it("invokes the injected scorer for Orbital; tests reuse it for an external operator", async () => {
    const store = memoryStore([
      {
        workerId: "ext-1",
        operatorId: "ext-op",
        windowId: "ew1",
        status: "late",
        ledgerStart: 90,
        ledgerEnd: 95,
      },
    ]);
    const scored: string[] = [];
    const scorer = recordingScorer(scored);
    const { input } = deps({ store, scorer, windows: [window("fired")] });
    await evaluateBackstopSlo(input);
    await scorer.score(store, "ext-op");
    expect(scored).toContain(ORBITAL_BACKSTOP_OPERATOR_ID);
    expect(scored).toContain("ext-op");
  });

  it("breaches and alerts once when an Orbital window is missed", async () => {
    const { input, alertTransition } = deps({ windows: [window("missed")] });
    const result = await evaluateBackstopSlo(input);
    expect(result.status).toBe("breached");
    expect(result.abiRecord.contractId).toBe(`backstop:${ORBITAL_BACKSTOP_OPERATOR_ID}`);
    expect(result.abiRecord.status).toBe("mismatch");
    expect(alertTransition).toHaveBeenCalledTimes(1);
  });

  it("breaches when XLM float is below the min and meets when equal", async () => {
    const low = deps({
      windows: [window("fired")],
      xlmFloatStroops: 999_999n,
    });
    const lowResult = await evaluateBackstopSlo(low.input);
    expect(lowResult.status).toBe("breached");
    expect(low.alertTransition).toHaveBeenCalledTimes(1);

    const eq = deps({
      windows: [window("fired")],
      xlmFloatStroops: 1_000_000n,
    });
    const eqResult = await evaluateBackstopSlo(eq.input);
    expect(eqResult.status).toBe("meeting");
    expect(eq.alertTransition).not.toHaveBeenCalled();
  });

  it("breaches when monitoring lag exceeds grace and meets when equal", async () => {
    const over = deps({
      windows: [window("fired")],
      chainHeadLedger: 201,
      lastProcessedLedger: 190,
    });
    expect((await evaluateBackstopSlo(over.input)).status).toBe("breached");

    const eq = deps({
      windows: [window("fired")],
      chainHeadLedger: 200,
      lastProcessedLedger: 190,
    });
    expect((await evaluateBackstopSlo(eq.input)).status).toBe("meeting");
  });

  it("returns unverifiable when there are no windows and float/lag are ok", async () => {
    const { input, alertTransition } = deps({ windows: [] });
    const result = await evaluateBackstopSlo(input);
    expect(result.status).toBe("unverifiable");
    expect(result.abiRecord.status).toBe("unverifiable");
    expect(result.operatorScore.kind).toBe("insufficient-data");
    expect(alertTransition).not.toHaveBeenCalled();
  });

  it("throws BackstopSloError for out-of-range ledgers and negative stroops", async () => {
    await expect(
      evaluateBackstopSlo(deps({ chainHeadLedger: 1_000_001 }).input),
    ).rejects.toMatchObject({ name: "BackstopSloError", code: "LEDGER_OUT_OF_RANGE" });

    await expect(
      evaluateBackstopSlo(deps({ lastProcessedLedger: 201, chainHeadLedger: 200 }).input),
    ).rejects.toMatchObject({ name: "BackstopSloError", code: "LEDGER_OUT_OF_RANGE" });

    await expect(evaluateBackstopSlo(deps({ xlmFloatStroops: -1n }).input)).rejects.toMatchObject({
      name: "BackstopSloError",
      code: "STROOPS_OUT_OF_RANGE",
    });

    await expect(
      evaluateBackstopSlo(deps({ xlmFloatStroops: MAX_STROOPS + 1n }).input),
    ).rejects.toMatchObject({ name: "BackstopSloError", code: "STROOPS_OUT_OF_RANGE" });

    await expect(
      evaluateBackstopSlo(
        deps({
          bounds: { ...BOUNDS, gracePeriodLedgers: 0 },
        }).input,
      ),
    ).rejects.toMatchObject({ name: "BackstopSloError", code: "BOUNDS_OUT_OF_RANGE" });

    expect(BackstopSloError).toBeDefined();
  });

  it("does not re-alert on a repeated breach; alerts on recovery", async () => {
    const store = new InMemoryVerdictStore();
    const alertTransition = vi.fn(async () => {});
    const workerStore = memoryStore();
    const scored: string[] = [];
    const base = {
      bounds: BOUNDS,
      xlmFloatStroops: 1_000_000n,
      chainHeadLedger: 200,
      lastProcessedLedger: 190,
      store: workerStore,
      scorer: recordingScorer(scored),
      alertManager: { alertTransition },
      sloVerdictStore: store,
    };

    await evaluateBackstopSlo({ ...base, windows: [window("missed", "a")] });
    await evaluateBackstopSlo({ ...base, windows: [window("missed", "b")] });
    expect(alertTransition).toHaveBeenCalledTimes(1);

    await evaluateBackstopSlo({ ...base, windows: [window("fired", "c")] });
    expect(alertTransition).toHaveBeenCalledTimes(2);
    const [, recovered] = alertTransition.mock.calls[1]!;
    expect(recovered.status).toBe("verified");
  });

  it("rejects missing dependencies and unknown window status", async () => {
    await expect(evaluateBackstopSlo(deps({ store: undefined }).input)).rejects.toMatchObject({
      code: "MISSING_DEPENDENCY",
    });
    await expect(evaluateBackstopSlo(deps({ scorer: undefined }).input)).rejects.toMatchObject({
      code: "MISSING_DEPENDENCY",
    });
    await expect(
      evaluateBackstopSlo(deps({ alertManager: undefined }).input),
    ).rejects.toMatchObject({ code: "MISSING_DEPENDENCY" });
    await expect(
      evaluateBackstopSlo(
        deps({
          windows: [{ ...window("fired"), status: "nope" as WorkerWindowStatus }],
        }).input,
      ),
    ).rejects.toMatchObject({ code: "UNKNOWN_VERDICT" });
    await expect(
      evaluateBackstopSlo(
        deps({
          windows: [{ ...window("fired"), operatorId: "" }],
        }).input,
      ),
    ).rejects.toMatchObject({ code: "INVALID_OPERATOR" });
    await expect(
      evaluateBackstopSlo(
        deps({
          windows: [{ ...window("fired"), operatorId: "x".repeat(129) }],
        }).input,
      ),
    ).rejects.toMatchObject({ code: "INVALID_OPERATOR" });
  });
});
