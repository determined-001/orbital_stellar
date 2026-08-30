import { parseExpression } from 'cron-parser';

export interface IntervalSchedule {
  type: 'interval';
  intervalMs: number;
}

export interface CronSchedule {
  type: 'cron';
  expression: string;
  timezone?: string;
}

export type Schedule = IntervalSchedule | CronSchedule;

export function nextDue(schedule: Schedule, after: Date): Date {
  if (schedule.type === 'interval') {
    return new Date(after.getTime() + schedule.intervalMs);
  }
  const interval = parseExpression(schedule.expression, {
    currentDate: after,
    ...(schedule.timezone ? { tz: schedule.timezone } : {}),
  });
  return interval.next().toDate();
}

export function dueTimesBetween(schedule: Schedule, after: Date, to: Date): Date[] {
  const result: Date[] = [];
  if (to.getTime() <= after.getTime()) {
    return result;
  }

  if (schedule.type === 'interval') {
    let current = new Date(after.getTime() + schedule.intervalMs);
    while (current.getTime() <= to.getTime()) {
      result.push(current);
      current = new Date(current.getTime() + schedule.intervalMs);
    }
  } else {
    const interval = parseExpression(schedule.expression, {
      currentDate: after,
      ...(schedule.timezone ? { tz: schedule.timezone } : {}),
    });
    let current = interval.next().toDate();
    while (current.getTime() <= to.getTime()) {
      result.push(current);
      current = interval.next().toDate();
    }
  }

  return result;
}
