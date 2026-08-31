/**
 * The worker definition model (issue #1038, "18.3 worker-core package scaffold
 * and the worker definition model").
 *
 * §C.2's constraint (the trigger is not a custodian) shapes every type here:
 * a worker's `operator` account holds the on-chain authority for the
 * submission, and the definition itself never carries a way to act as that
 * account. See `README.md` for the constraint in full; `docs/design/workers.md`
 * (18.13) is the eventual architecture-decision record for it.
 */

/** Stellar networks a worker definition can target. */
export type Network = "testnet" | "mainnet" | "futurenet";

/**
 * Ledger state a worker's argument builder is allowed to read. Deliberately a
 * narrow, serializable snapshot - not a live RPC handle - so that "pure
 * function of observed chain state" (see `ArgBuilder`) is enforceable rather
 * than just documented: there is nothing reachable from `ChainState` that
 * could make two calls with the same state disagree.
 */
export interface ChainState {
  /** The ledger sequence this snapshot was observed at. */
  readonly ledgerSequence: number;
  /** That ledger's close time, Unix seconds. */
  readonly closeTimeUnix: number;
}

/**
 * Builds a Soroban function's arguments from observed chain state only.
 *
 * This must be a pure function: same `ChainState` in, same `TArgs` out, no
 * hidden reads (wall-clock time, ambient RPC calls, local mutable state). That
 * purity is what makes a worker's submission reproducible from the ledger
 * alone, which 19.1's verification depends on - a verifier that can't
 * reconstruct the arguments from the same chain state can't confirm the
 * submission was legitimate.
 */
export type ArgBuilder<TArgs extends readonly unknown[] = readonly unknown[]> = (
  state: ChainState,
) => TArgs | Promise<TArgs>;

/**
 * Interval and cron schedules both carry an explicit timezone: a bare cron
 * expression ("0 0 * * *") is ambiguous without one, and defaulting to the
 * host process's local timezone would make a worker's execution times depend
 * on where it happens to run rather than on the definition itself.
 */
interface ScheduleBase {
  /** IANA timezone name, e.g. `"UTC"` or `"America/New_York"`. */
  timezone: string;
}

export interface IntervalSchedule extends ScheduleBase {
  kind: "interval";
  /** Milliseconds between executions. */
  everyMs: number;
}

export interface CronSchedule extends ScheduleBase {
  kind: "cron";
  /** Standard 5-field cron expression, interpreted in `timezone`. */
  expression: string;
}

export type Schedule = IntervalSchedule | CronSchedule;

export interface TimeTrigger {
  kind: "time";
  schedule: Schedule;
}

/**
 * Present as a type from W0 so the `Trigger` union does not need reshaping
 * when event-based execution ships in W2 (19.x-22.x extend this union rather
 * than replace it) - but not executable yet. See `assertImplementedTrigger`.
 */
export interface EventTrigger {
  kind: "event";
  /** Contract whose events this trigger watches. */
  contractId: string;
  /** Dot-namespaced event topic (matches the `abi-registry` taxonomy format). */
  eventTopic: string;
}

/**
 * Present as a type from W0 for the same reason as `EventTrigger` - not
 * executable until W2/W3. The shape here is intentionally minimal; it widens
 * once the computation-trigger design lands.
 */
export interface ComputationTrigger {
  kind: "computation";
  /** Human-readable description of the off-chain computation being watched. */
  description: string;
}

/**
 * Discriminated union over every trigger class a worker can eventually have.
 * Only `TimeTrigger` executes in W0 - `assertImplementedTrigger` enforces that
 * at runtime, and `test/types.exhaustive.test-d.ts` proves this union is
 * exhaustively handled wherever it's switched over.
 */
export type Trigger = TimeTrigger | EventTrigger | ComputationTrigger;

/**
 * Thrown by `assertImplementedTrigger` for any `Trigger` whose kind does not
 * execute yet.
 */
export class TriggerNotImplementedError extends Error {
  readonly kind: Exclude<Trigger["kind"], TimeTrigger["kind"]>;

  constructor(kind: Exclude<Trigger["kind"], TimeTrigger["kind"]>) {
    super(
      `Trigger kind "${kind}" is not implemented until W2. Only "time" triggers execute in W0.`,
    );
    this.name = "TriggerNotImplementedError";
    this.kind = kind;
  }
}

/**
 * Narrows `trigger` to `TimeTrigger`, throwing `TriggerNotImplementedError`
 * for the `event` and `computation` variants. Every submission path must call
 * this before acting on a `Trigger` - it is the runtime half of "present as a
 * type, rejected at runtime" from the issue's acceptance criteria.
 */
export function assertImplementedTrigger(trigger: Trigger): asserts trigger is TimeTrigger {
  if (trigger.kind !== "time") {
    throw new TriggerNotImplementedError(trigger.kind);
  }
}

/**
 * Covers only the fee-bump *source account and cap* - never a signer. Signing
 * the fee-bump transaction is the submitter's responsibility (18.5), exactly
 * like signing the inner transaction; this policy just says which account
 * pays and how much it will cover.
 */
export interface FeeBumpPolicy {
  /** Public key (`G...`) of the fee-bump source account. */
  sourceAccount: string;
  /** Maximum additional stroops the source account will cover per submission. */
  maxFeeStroops: number;
}

/**
 * What a worker *is*: the off-chain condition (`trigger`) that decides when to
 * submit, and the on-chain call (`operator`, `targetContractId`, `functionName`,
 * `buildArgs`) to submit when it fires.
 *
 * Deliberately absent: anything that could carry a user's secret key. A
 * worker needs no signing authority of its own to exist as a definition -
 * signing happens downstream, in the submitter (18.5), scoped to `operator`'s
 * own account. If a future field looks like it wants to hold key material,
 * that is a design bug in whatever needs it, not a gap in this type - see the
 * §C.2 note at the top of this file.
 */
export interface WorkerDefinition<TArgs extends readonly unknown[] = readonly unknown[]> {
  /** Unique identifier for this worker definition. */
  id: string;
  /** Public key (`G...`) whose authority backs every submission this worker makes. */
  operator: string;
  /** Soroban contract id (`C...`) the worker invokes. */
  targetContractId: string;
  /** Name of the contract function to invoke. */
  functionName: string;
  /** Reproducible-from-the-ledger argument builder. See `ArgBuilder`. */
  buildArgs: ArgBuilder<TArgs>;
  /** The off-chain condition that decides when to submit. */
  trigger: Trigger;
  /** Network this worker submits to. */
  network: Network;
  /** Optional fee-bump policy; omit to have the operator account pay its own fee. */
  feeBump?: FeeBumpPolicy;
}
