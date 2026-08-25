import type { Sep24Status } from "@orbital-stellar/pulse-core";

/** Thrown when a SEP-24 transaction is moved to a status it cannot reach. */
export class InvalidSep24TransitionError extends Error {
  constructor(
    public readonly from: Sep24Status,
    public readonly to: Sep24Status,
  ) {
    super(`[anchor-sdk] invalid SEP-24 status transition: ${from} -> ${to}`);
    this.name = "InvalidSep24TransitionError";
  }
}

/** Statuses from which a transaction can no longer move. */
export const SEP24_TERMINAL_STATUSES = [
  "completed",
  "refunded",
  "expired",
  "no_market",
  "too_small",
  "too_large",
  "error",
] as const satisfies readonly Sep24Status[];

/**
 * Allowed transitions per SEP-24. Anchors differ in which intermediate states
 * they use, so the graph is permissive between pending states and strict about
 * the two things that actually matter: nothing leaves a terminal state, and
 * nothing re-enters `incomplete` once the flow has started.
 */
const TRANSITIONS: Record<Sep24Status, readonly Sep24Status[]> = {
  incomplete: [
    "pending_user_transfer_start",
    "pending_anchor",
    "pending_user",
    "pending_trust",
    "expired",
    "too_small",
    "too_large",
    "no_market",
    "error",
  ],
  pending_user_transfer_start: [
    "pending_user_transfer_complete",
    "pending_anchor",
    "pending_external",
    "pending_stellar",
    "pending_trust",
    "pending_user",
    "completed",
    "refunded",
    "expired",
    "error",
  ],
  pending_user_transfer_complete: [
    "pending_anchor",
    "pending_external",
    "pending_stellar",
    "completed",
    "refunded",
    "error",
  ],
  pending_external: ["pending_anchor", "pending_stellar", "completed", "refunded", "error"],
  pending_anchor: [
    "pending_stellar",
    "pending_trust",
    "pending_user",
    "pending_external",
    "completed",
    "refunded",
    "error",
  ],
  pending_stellar: ["pending_trust", "pending_anchor", "completed", "refunded", "error"],
  pending_trust: ["pending_stellar", "pending_anchor", "completed", "refunded", "error"],
  pending_user: ["pending_anchor", "pending_stellar", "completed", "refunded", "expired", "error"],
  completed: [],
  refunded: [],
  expired: [],
  no_market: [],
  too_small: [],
  too_large: [],
  error: [],
};

/**
 * Tracks one SEP-24 transaction's status.
 *
 * Polling anchors re-report the same status constantly, so re-applying the
 * current status is a no-op rather than an error. Moving to a status the spec
 * does not allow throws - silently overwriting it is how a consumer ends up
 * marking a refunded deposit as completed.
 */
export class Sep24StatusMachine {
  private status: Sep24Status;
  private readonly seen: Sep24Status[];

  constructor(initialStatus: Sep24Status = "incomplete") {
    this.status = initialStatus;
    this.seen = [initialStatus];
  }

  /** The current status. */
  get current(): Sep24Status {
    return this.status;
  }

  /** Every status this transaction has held, in order. */
  get history(): readonly Sep24Status[] {
    return this.seen;
  }

  /** Whether the transaction can still move. */
  get isTerminal(): boolean {
    return (SEP24_TERMINAL_STATUSES as readonly Sep24Status[]).includes(this.status);
  }

  /** Whether `next` is reachable from the current status. */
  canTransitionTo(next: Sep24Status): boolean {
    if (next === this.status) return true;
    return TRANSITIONS[this.status].includes(next);
  }

  /**
   * Moves to `next`.
   *
   * @returns `true` when the status changed, `false` for a repeated poll of the
   *   same status.
   * @throws {InvalidSep24TransitionError} when the transition is not allowed.
   */
  transitionTo(next: Sep24Status): boolean {
    if (next === this.status) return false;
    if (!this.canTransitionTo(next)) {
      throw new InvalidSep24TransitionError(this.status, next);
    }
    this.status = next;
    this.seen.push(next);
    return true;
  }
}
