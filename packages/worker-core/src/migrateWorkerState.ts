import { WorkerStateStore } from "./WorkerStateStore.js";

export interface MigrateWorkerStateResult {
  migrated: number;
}

/**
 * Copies all worker state from `source` to `target`.
 *
 * For each worker returned by `source.getAllWorkers()`, the function:
 *  1. Calls `target.registerWorker` (idempotent — existing workers are skipped).
 *  2. Re-appends every fire record in chronological order.
 *  3. Re-writes every active claim.
 *
 * This mirrors the pattern of `migrateCursors.ts` in pulse-core.
 *
 * **Fire-history integrity**: records are replayed in the order they appear in
 * the source. The append-only constraint on the target store means no existing
 * history is ever overwritten — duplicates may result if you run migration
 * twice against a non-empty target; de-duplicate with `firedAt` on read if
 * needed.
 *
 * @returns The number of workers migrated.
 */
export async function migrateWorkerState(
  source: WorkerStateStore,
  target: WorkerStateStore,
): Promise<MigrateWorkerStateResult> {
  const workers = await source.getAllWorkers();

  for (const worker of workers) {
    await target.registerWorker({
      workerId: worker.workerId,
      registeredAt: worker.registeredAt,
      metadata: { ...worker.metadata },
    });

    for (const record of worker.fireHistory) {
      await target.appendFireRecord({ workerId: worker.workerId, record });
    }

    for (const claim of worker.activeClaims) {
      await target.writeClaim({ workerId: worker.workerId, claim });
    }
  }

  return { migrated: workers.length };
}
