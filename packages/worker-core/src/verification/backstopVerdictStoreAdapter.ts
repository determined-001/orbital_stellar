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
  WorkerWindowVerdict,
} from "../backstop/slo.js";
import type { WorkerFireVerdictStore } from "./WorkerFireVerdictStore.js";
import type { WorkerVerdictRecord } from "./WorkerFireVerdictStore.js";

function toWindowVerdict(record: WorkerVerdictRecord): WorkerWindowVerdict {
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
      return records.map(toWindowVerdict);
    },
  };
}
