/**
 * Intervention records for the backstop (issue 21.1).
 *
 * §C.7's mechanism: when a registered external worker fails to fire, an Orbital
 * worker catches the miss and triggers the contract. Every such fire is
 * recorded here, linked to the verdict of the window it covered.
 *
 * The link is not bookkeeping. An intervention is Orbital acting on a
 * subscriber's behalf and charging for readiness, so it has to be answerable:
 * which window, which verdict, and what the primary was given the chance to do
 * first. An intervention that cannot name the miss it covered is
 * indistinguishable from a backstop that fired because it felt like it.
 */
import type { WindowVerdict } from "./windowVerdict.js";

/** Why a backstop fired. Only one value today; named rather than implied so the record stays legible when W3 grows. */
export type InterventionCause = "primary-missed";

/** A backstop fire, and the evidence for it. */
export type Intervention = {
  readonly windowId: string;
  readonly workerId: string;
  readonly subscriptionId: string;
  readonly cause: InterventionCause;
  /** The verdict this intervention answers. Required — see the module note. */
  readonly verdict: WindowVerdict;
  /** Ledger at which the backstop decided to fire. */
  readonly decidedAtLedger: number;
  /** Deadline the primary was held to, plus the grace period actually applied. */
  readonly primaryDeadlineLedger: number;
  readonly graceLedgers: number;
};

/**
 * Where interventions are recorded.
 *
 * Separate from the notifier: recording is the audit trail and must not be
 * skipped, while notification is a delivery concern that may fail and be
 * retried. Folding them together would let a webhook outage lose the record.
 */
export interface InterventionRecorder {
  record(intervention: Intervention): Promise<void> | void;
}

/**
 * Subscriber notification on intervention.
 *
 * A subscriber whose worker was backstopped has to find out — it is the signal
 * that their operator is failing, and the whole reason they are paying for
 * readiness.
 */
export interface InterventionNotifier {
  notify(intervention: Intervention): Promise<void> | void;
}

/** In-memory recorder for tests and single-process runs. Not durable. */
export class InMemoryInterventionRecorder implements InterventionRecorder {
  readonly interventions: Intervention[] = [];

  record(intervention: Intervention): void {
    this.interventions.push(intervention);
  }
}
