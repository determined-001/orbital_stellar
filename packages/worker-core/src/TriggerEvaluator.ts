import { Schedule, dueTimesBetween } from './schedule';

export interface LedgerSource {
  getLatestLedgerCloseTime(): Promise<Date>;
}

export interface Clock {
  now(): Date;
}

export type CatchUpPolicy = 'fire-once' | 'fire-all';

export interface WorkerState {
  id: string;
  schedule: Schedule;
  anchorAt: Date;
  lastFiredAt: Date | null;
  catchUpPolicy?: CatchUpPolicy;
}

export interface FireDecision {
  workerId: string;
  fireTimes: Date[];
}

export interface TriggerEvaluatorOptions {
  ledgerSource: LedgerSource;
  clock: Clock;
  minPollIntervalMs?: number;
}

export class TriggerEvaluator {
  private readonly ledgerSource: LedgerSource;
  private readonly clock: Clock;
  private readonly minPollIntervalMs: number;
  private lastPollAt: Date | null = null;

  constructor(options: TriggerEvaluatorOptions) {
    this.ledgerSource = options.ledgerSource;
    this.clock = options.clock;
    this.minPollIntervalMs = options.minPollIntervalMs ?? 5_000;
  }

  async poll(workers: WorkerState[]): Promise<FireDecision[]> {
    const now = this.clock.now();
    if (this.lastPollAt !== null) {
      const elapsed = now.getTime() - this.lastPollAt.getTime();
      if (elapsed < this.minPollIntervalMs) {
        return [];
      }
    }
    this.lastPollAt = now;

    const ledgerCloseTime = await this.ledgerSource.getLatestLedgerCloseTime();
    const decisions: FireDecision[] = [];

    for (const worker of workers) {
      const decision = this.evaluate(worker, ledgerCloseTime);
      if (decision) {
        decisions.push(decision);
      }
    }

    return decisions;
  }

  evaluate(worker: WorkerState, ledgerCloseTime: Date): FireDecision | null {
    const from = worker.lastFiredAt ?? worker.anchorAt;
    if (!from) {
      return null;
    }

    const dueTimes = dueTimesBetween(worker.schedule, from, ledgerCloseTime);
    if (dueTimes.length === 0) {
      return null;
    }

    const policy = worker.catchUpPolicy ?? 'fire-once';
    if (policy === 'fire-once') {
      return { workerId: worker.id, fireTimes: [ledgerCloseTime] };
    }
    return { workerId: worker.id, fireTimes: dueTimes };
  }
}
