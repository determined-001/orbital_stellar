import {
  WorkerFireVerdictStore,
  DuplicateVerdictRecordError,
  type WorkerVerdictRecord,
  type WorkerVerdictQueryOptions,
} from "./WorkerFireVerdictStore.js";

/** In-process reference implementation of {@link WorkerFireVerdictStore}. Not durable across restarts. */
export class MemoryWorkerVerdictStore extends WorkerFireVerdictStore {
  private readonly byRecordId = new Map<string, WorkerVerdictRecord>();
  private readonly byWindowId = new Map<string, WorkerVerdictRecord[]>();

  protected async _write(record: WorkerVerdictRecord): Promise<void> {
    if (this.byRecordId.has(record.recordId)) {
      throw new DuplicateVerdictRecordError(record.recordId);
    }
    this.byRecordId.set(record.recordId, record);
    const forWindow = this.byWindowId.get(record.windowId) ?? [];
    forWindow.push(record);
    this.byWindowId.set(record.windowId, forWindow);
  }

  async getLatestForWindow(windowId: string): Promise<WorkerVerdictRecord | null> {
    return latestOf(this.byWindowId.get(windowId) ?? []);
  }

  async getHistoryForWindow(windowId: string): Promise<WorkerVerdictRecord[]> {
    return [...(this.byWindowId.get(windowId) ?? [])];
  }

  async queryByWorker(
    workerId: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]> {
    return this.query((r) => r.workerId === workerId, options);
  }

  async queryByOperator(
    operator: string,
    options?: WorkerVerdictQueryOptions,
  ): Promise<WorkerVerdictRecord[]> {
    return this.query((r) => r.operator === operator, options);
  }

  async queryByLedgerRange(
    fromLedger: number,
    toLedger: number,
    options?: Omit<WorkerVerdictQueryOptions, "fromLedger" | "toLedger">,
  ): Promise<WorkerVerdictRecord[]> {
    return this.query(
      (r) => r.conditionLedger <= toLedger && r.deadlineLedger >= fromLedger,
      options,
    );
  }

  private query(
    matches: (r: WorkerVerdictRecord) => boolean,
    options?: WorkerVerdictQueryOptions,
  ): WorkerVerdictRecord[] {
    const latestOnly = options?.latestOnly ?? true;
    const results: WorkerVerdictRecord[] = [];
    const windowIds = latestOnly ? new Set<string>() : null;

    for (const record of this.byRecordId.values()) {
      if (!matches(record)) continue;
      if (options?.fromLedger !== undefined && record.deadlineLedger < options.fromLedger) continue;
      if (options?.toLedger !== undefined && record.conditionLedger > options.toLedger) continue;
      if (windowIds) windowIds.add(record.windowId);
      else results.push(record);
    }

    if (windowIds) {
      for (const windowId of windowIds) {
        const latest = latestOf(this.byWindowId.get(windowId) ?? []);
        if (latest && matches(latest)) results.push(latest);
      }
    }

    return results;
  }
}

/** The newest record in a window's history, following the supersession chain. */
function latestOf(history: ReadonlyArray<WorkerVerdictRecord>): WorkerVerdictRecord | null {
  if (history.length === 0) return null;
  const superseded = new Set(history.filter((r) => r.supersedes).map((r) => r.supersedes));
  const notSuperseded = history.filter((r) => !superseded.has(r.recordId));
  // Every record has a distinct recordedAt in practice; recordId as a tiebreaker
  // keeps this deterministic even if two records share a timestamp exactly.
  notSuperseded.sort((a, b) => {
    const byTime = a.recordedAt.localeCompare(b.recordedAt);
    return byTime !== 0 ? byTime : a.recordId.localeCompare(b.recordId);
  });
  return notSuperseded[notSuperseded.length - 1] ?? null;
}
