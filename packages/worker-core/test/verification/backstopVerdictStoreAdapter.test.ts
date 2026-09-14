import { describe, it, expect, vi } from "vitest";
import { InMemoryVerdictStore } from "@orbital-stellar/abi-registry";
import { ORBITAL_BACKSTOP_OPERATOR_ID, evaluateBackstopSlo } from "../../src/backstop/slo.js";
import type {
  EvaluateBackstopSloInput,
  OperatorScorer,
  WorkerWindowVerdict,
} from "../../src/backstop/slo.js";
import { MemoryWorkerVerdictStore } from "../../src/verification/MemoryWorkerVerdictStore.js";
import { toBackstopVerdictStore } from "../../src/verification/backstopVerdictStoreAdapter.js";

/**
 * Proves the real integration this session's #1050 work exists to enable:
 * a concrete WorkerFireVerdictStore, adapted, actually satisfies the
 * already-shipped evaluateBackstopSlo's dependency - not just that the
 * types happen to line up.
 */
describe("toBackstopVerdictStore + evaluateBackstopSlo integration", () => {
  it("records windows into the real store and reads them back for scoring", async () => {
    const realStore = new MemoryWorkerVerdictStore();
    let counter = 0;
    const adapter = toBackstopVerdictStore(realStore, (verdict) => ({
      recordId: `${verdict.windowId}:${++counter}`,
      engineVersion: "@orbital-stellar/worker-core@test",
    }));

    const scorer: OperatorScorer = {
      score: vi.fn().mockResolvedValue({
        operatorId: ORBITAL_BACKSTOP_OPERATOR_ID,
        formulaVersion: "v1",
        kind: "scored",
      }),
    };

    const windows: WorkerWindowVerdict[] = [
      {
        workerId: "backstop-w1",
        operatorId: ORBITAL_BACKSTOP_OPERATOR_ID,
        windowId: "backstop-w1:ev-1",
        status: "fired",
        ledgerStart: 100,
        ledgerEnd: 110,
      },
    ];

    const input: EvaluateBackstopSloInput = {
      windows,
      bounds: {
        latencyBoundLedgers: 10,
        gracePeriodLedgers: 5,
        xlmFloatMinStroops: 0n,
        monitoringLagGraceLedgers: 100,
      },
      xlmFloatStroops: 1_000_000_000n,
      chainHeadLedger: 200,
      lastProcessedLedger: 200,
      store: adapter,
      scorer,
      alertManager: { alertTransition: vi.fn() },
      sloVerdictStore: new InMemoryVerdictStore(),
    };

    const result = await evaluateBackstopSlo(input);

    expect(result.status).toBe("meeting");
    // The window landed in the real, concrete store - not just the adapter's
    // own memory - proving the adapter actually wrote through.
    const stored = await realStore.getLatestForWindow("backstop-w1:ev-1");
    expect(stored).toMatchObject({
      workerId: "backstop-w1",
      operator: ORBITAL_BACKSTOP_OPERATOR_ID,
      status: "fired",
      conditionLedger: 100,
      deadlineLedger: 110,
      engineVersion: "@orbital-stellar/worker-core@test",
    });
  });
});
