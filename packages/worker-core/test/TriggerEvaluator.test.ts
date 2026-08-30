import { TriggerEvaluator, WorkerState } from '../src/TriggerEvaluator';
import { Schedule, nextDue, dueTimesBetween } from '../src/schedule';

describe('schedule', ()=>{
  test('nextDue interval', ()=>{
    const schedule: Schedule = { type: 'interval', intervalMs: 60000 };
    const after = new Date('2024-01-01T00:00:00Z');
    expect(nextDue(schedule, after).toISOString()).toBe('2024-01-01T00:01:00.000Z');
  });

  test('nextDue cron', ()=>{
    const schedule: Schedule = { type: 'cron', expression: '0 0 * * *' };
    const after = new Date('2024-01-01T00:00:00Z');
    expect(nextDue(schedule, after).toISOString()).toBe('2024-01-02T00:00:00.000Z');
  });

  test('dueTimesBetween interval', ()=>{
    const schedule: Schedule = { type: 'interval', intervalMs: 600000 };
    const from = new Date('2024-01-01T00:00:00Z');
    const to = new Date('2024-01-01T00:35:00Z');
    const times = dueTimesBetween(schedule, from, to);
    expect(times.map(t => t.toISOString())).toEqual([
      '2024-01-01T00:10:00.000Z',
      '2024-01-01T00:20:00.000Z',
      '2024-01-01T00:30:00.000Z',
    ]);
  });

  test('cron nextDue respects timezone across DST boundary', ()=>{
    const schedule: Schedule = { type: 'cron', expression: '0 2 * * *', timezone: 'America/New_York' };
    const before = new Date('2024-03-08T12:00:00Z');
    expect(nextDue(schedule, before).toISOString()).toBe('2024-03-09T07:00:00Z');
    const after = new Date('2024-03-11T12:00:00Z');
    expect(nextDue(schedule, after).toISOString()).toBe('2024-03-12T06:00:00Z');
  });

  test('cron skips non-existent DST times', ()=>{
    const schedule: Schedule = { type: 'cron', expression: '0 2 * * *', timezone: 'America/New_York' };
    const after = new Date('2024-03-09T07:00:00Z');
    expect(nextDue(schedule, after).toISOString()).toBe('2024-03-11T06:00:00Z');
  });

  test('dueTimesBetween cron respects timezone across!OT boundary', ()=>{
    const schedule: Schedule = { type: 'cron', expression: '0 2 * * *', timezone: 'America/New_York' };
    const from = new Date('2024-03-08T00:00:00Z');
    const to = new Date('2024-03-12T00:00:00Z');
    const times = dueTimesBetween(schedule, from, to);
    expect(times.map(t => t.toISOString())).toEqual([
      '2024-03-08T07:00:00.000Z',
      '2024-03-09T07:00:00.000Z',
      '2024-03-11T06:00:00.000Z',
      '2024-03-12T06:00:00.000Z',
    ]);
  });
});

describe('TriggerEvaluator', ()=>{
  const baseWorker: Omit<WorkerState, 'id'> = {
    schedule: { type: 'interval', intervalMs: 600000 },
    anchorAt: new Date('2024-01-01T00:00:00Z'),
    lastFiredAt: null,
    catchUpPolicy: 'fire-once',
  };

  const makeWorker = (overrides: Partial<WorkerState>):(WorkerState) => ({
    ...baseWorker,
    id: 'w1',
    ...overrides,
  });

  test('evaluate returns one fireTime when fire-once even if multiple missed', ()=>{
    const worker = makeWorker({
      lastFiredAt: new Date('2024-01-01T00:03:00Z'),
      catchUpPolicy: 'fire-once',
    });
    const ledger = new Date('2024-01-01T00:35:00Z');
    const evaluator = new TriggerEvaluator({
      ledgerSource: { getLatestLedgerCloseTime: async () => ledger },
      clock: { now: () => new Date() },
    });
    const decision = evaluator.evaluate(worker, ledger);
    expect(decision).not.toBeNull();
    expect(decision!.fireTimes).toHaveLength(1);
    expect(decision!.fireTimes[0].toISOString()).toBe('2024-01-01T00:35:00.000Z');
  });

  test('evaluate returns all missed fireTimes when fire-all', ()=>{
    const worker = makeWorker({
      lastFiredAt: new Date('2024-01-01T00:00:00Z'),
      catchUpPolicy: 'fire-all',
    });
    const ledger = new Date('2024-01-01T00:35:00Z');
    const evaluator = new TriggerEvaluator({
      ledgerSource: { getLatestLedgerCloseTime: async () => ledger },
      clock: { now: () => new Date() },
    });
    const decision = evaluator.evaluate(worker, ledger);
    expect(decision).not.toBeNull();
    expect(decision!.fireTimes).toHaveLength(3);
    expect(decision!.fireTimes.map(t => t.toISOString())).toEqual([
      '2024-01-01T00:10:00.000Z',
      '2024-01-01T00:20:00.000Z',
      '2024-01-01T00:30:00.000Z',
    ]);
  });

  test('evaluate returns null when not due', ()=>{
    const worker = makeWorker({
      lastFiredAt: new Date('2024-01-01T00:00:00Z'),
    });
    const ledger = new Date('2024-01-01T00:05:00Z');
    const evaluator = new TriggerEvaluator({
      ledgerSource: { getLatestLedgerCloseTime: async () => ledger },
      clock: { now: () => new Date() },
    });
    expect(evaluator.evaluate(worker, ledger)).toBeNull();
  });

  test('poll respects minPollIntervalMs', async () => {
    let now = new Date('2024-01-01T00:00:00Z');
    let ledgerCalls = 0;
    const ledgerSource = {
      getLatestLedgerCloseTime: async () => {
        ledgerCalls++;
        return new Date('2024-01-01T00:00:00Z');
      },
    };
    const clock = { now: () => now };
    const evaluator = new TriggerEvaluator(
      { ledgerSource, clock, minPollIntervalMs: 1000 },
    );

    await evaluator.poll([]);
    expect(ledgerCalls).toBe(1);

    now = new Date('2024-01-01T00:00:00.500Z');
    await evaluator.poll([]);
    expect(ledgerCalls).toBe(1);

    now = new Date('2024-01-01T00:00:01.000Z');
    await evaluator.poll([]);
    expect(ledgerCalls).toBe(2);
  });
});