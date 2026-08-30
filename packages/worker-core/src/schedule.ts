import { parseExpression } from 'cron-parser';

export type CatchUpPolicy = 'fire-once' | 'fire-all';

export interface IntervalSchedule {
  type: 'interval';
  intervalMs: number;
  /**
   * Catch-up policy when the worker misses scheduled windows.
   * Defaults to 'fire-once'.
   */
  catchUp?: CatchUpPolicy;
}

export interface CronSchedule {
  type: 'cron';
  expression: string;
  timezone?: string;
  /**
   * Catch-up policy when the worker misses scheduled windows.
   * Defaults to 'fire-once'.
   */
  catchUp?: CatchUpPolicy;
}

export type Schedule = IntervalSchedule | CronSchedule;

/**
 * Returns the earliest ledger close time at or after the given time.
 * If this callback is provided to the scheduling functions, the returned
 * due times are aligned to ledger close times, which is the correct
 * reference for Stellar time-based workers.
 */
export type NextLedgerCloseTime = (after: Date) : Date;

export function nextDue(
  schedule: Schedule,
  after: Date,
  nextLedgerCloseTime?: NextLedgerCloseTime,
): Date {
  let due: Date;
  if (schedule.type === 'interval') {
    due = new Date(after.getTime() + schedule.intervalMs);
  } else {
    const interval = parseExpression(schedule.expression, {
      currentDate: after,
      ...(schedule.timezone ? { tz: schedule.timezone } : {}),
    });
    due = interval.next().toDate();
  }
  return nextLedgerCloseTime ? nextLedgerCloseTime(due) : due;
}

export function dueTimesBetween(
  schedule: Schedule,
  after: Date,
  to: Date,
  nextLedgerCloseTime?: NextLedgerCloseTime,
): Date[] {
  const result: Date[] = [];
  if (to.getTime() <= after.getTime()) {
    return result;
  }

  const seen = new Set<number>();

  if (schedule.type === 'interval') {
    let current = new Date(after.getTime() + schedule.intervalMs);
    while (current.getTime() <= to.getTime()) {
      const due = nextLedgerCloseTime ? nextLedgerCloseTime(current) : current;
      if (due.getTime() > to.getTime()) {
        // All subsequent nominal times will also map to ledger close times
        // beyond `to`, so no more due times are possible.
        break;
      }
      const key = due.getTime();
      if (!seen.has(key)) {
        result.push(due);
        seen.add(key);
      }
      current = new Date(current.getTime() + schedule.intervalMs);
    }
  } else {
    const interval = parseExpression(schedule.expression, {
      currentDate: after,
      ...(schedule.timezone ? { tz: schedule.timezone } : {}),
    });
    let current = interval.next().toDate();
    while (current.getTime() <= to.getTime()) {
      const due = nextLedgerCloseTime ? nextLedgerCloseTime(current) : current;
      if (due.getTime() > to.getTime()) {
        break;
      }
      const key = due.getTime();
      if (!seen.has(key)) {
        result.push(due);
        seen.add(key);
      }
      current = interval.next().toDate();
    }
  }

  const catchUp = schedule.catchUp ?? 'fire-once';
  if (catchUp === 'fire-once' && result.length > 1) {
    return [result[result.length - 1]];
  }
  return result;
}
