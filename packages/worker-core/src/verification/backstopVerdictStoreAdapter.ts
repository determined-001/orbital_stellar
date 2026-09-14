/**
 * Adapts a {@link WorkerFireVerdictStore} to `backstop/slo.ts`'s narrower
 * `WorkerVerdictStore` port, so `evaluateBackstopSlo` (21.x, already
 * shipped) can read real verdicts once #1049's engine and this store have
 * produced them - see `WorkerFireVerdictStore.ts`'s "Relationship to
 * backstop/slo.ts" doc section for why these are two separate types
 * rather than one.
 */
import type {
  WorkerVerdictStore as BackstopWorkerVerdictStore,
  WorkerWindowStatus,
  WorkerWindowVerdict,
} from "../backstop/slo.js";
import type { WorkerFireVerdictStore } from "./WorkerFireVerdictStore.js";
import type { WorkerVerdictRecord } from "./WorkerFireVerdictStore.js";

/**
 * `WorkerWindowStatus` (backstop/slo.ts) predates this module's six-value
 * taxonomy and only has room for the four that were scoreable when it was
 * written. `pending` and `unverifiable` are excluded from scoring by
 * definition (`EXCLUDED_FROM_SCORING` in `workerFireVerdict.ts`) - a
 * backstop evaluator has nothing useful to do with them, so they are
 * filtered out here rather than forced into a status the SLO evaluator
 * would misinterpret.
 */
function isBackstopScoreable(
  record: WorkerVerdictRecord,
): record is WorkerVerdictRecord & { status: WorkerWindowStatus } {
  const { status } = record;
  return status === "fired" || status === "missed" || status === "late" || status === "not-due";
}

function toWindowVerdict(
  record: WorkerVerdictRecord & { status: WorkerWindowStatus },
): WorkerWindowVerdict {
  return {
    workerId: record.workerId,
    operatorId: record.operator,
    windowId: record.windowId,
    status: record.status,
    ledgerStart: record.conditionLedger,
    ledgerEnd: record.deadlineLedger,
  };
}

/**
 * Wraps `store` for `evaluateBackstopSlo`'s `store`/`sloVerdictStore`-shaped
 * dependency. `record()` on the returned adapter requires the caller to
 * supply the fields `WorkerFireVerdictStore` needs beyond what
 * `WorkerWindowVerdict` itself carries (`recordId`, `engineVersion`) via
 * `recordDefaults`, since the backstop port's `record(verdict)` signature
 * has no room for them - this is the one place those two contracts have to
 * be reconciled, and it happens here rather than by widening either type.
 */
export function toBackstopVerdictStore(
  store: WorkerFireVerdictStore,
  recordDefaults: (verdict: WorkerWindowVerdict) => { recordId: string; engineVersion: string },
): BackstopWorkerVerdictStore {
  return {
    async record(verdict: WorkerWindowVerdict): Promise<void> {
      const { recordId, engineVersion } = recordDefaults(verdict);
      await store.record({
        recordId,
        windowId: verdict.windowId,
        workerId: verdict.workerId,
        operator: verdict.operatorId,
        conditionLedger: verdict.ledgerStart,
        deadlineLedger: verdict.ledgerEnd,
        status: verdict.status,
        engineVersion,
      });
    },
    async getByOperator(operatorId: string): Promise<WorkerWindowVerdict[]> {
      const records = await store.queryByOperator(operatorId);
      return records.filter(isBackstopScoreable).map(toWindowVerdict);
    },
  };
}
