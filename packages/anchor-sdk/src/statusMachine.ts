import type { Sep31Status } from "@orbital-stellar/pulse-core";

export class InvalidStatusTransitionError extends Error {
  constructor(
    public from: Sep31Status,
    public to: Sep31Status,
  ) {
    super(`Invalid SEP-31 status transition: ${from} -> ${to}`);
    this.name = "InvalidStatusTransitionError";
  }
}

/**
 * Basic state machine for SEP-31 transactions.
 * Allows valid transitions based on SEP-31 specification.
 */
export class Sep31StatusMachine {
  private status: Sep31Status;

  // Defines allowed next states for each state
  private static readonly TRANSITIONS: Record<Sep31Status, Sep31Status[]> = {
    pending_sender: ["pending_stellar", "pending_transaction_info_update", "error"],
    pending_transaction_info_update: ["pending_sender", "pending_stellar", "error"],
    pending_stellar: ["pending_receiver", "pending_external", "completed", "error"],
    pending_receiver: ["pending_external", "completed", "error"],
    pending_external: ["completed", "error"],
    completed: [], // Terminal
    error: [], // Terminal
  };

  constructor(initialStatus: Sep31Status = "pending_sender") {
    this.status = initialStatus;
  }

  get current(): Sep31Status {
    return this.status;
  }

  /**
   * Transition to a new status. Throws InvalidStatusTransitionError if the transition is not allowed.
   */
  transitionTo(nextStatus: Sep31Status): void {
    if (this.status === nextStatus) return; // No-op

    const allowed = Sep31StatusMachine.TRANSITIONS[this.status];
    if (!allowed.includes(nextStatus)) {
      throw new InvalidStatusTransitionError(this.status, nextStatus);
    }

    this.status = nextStatus;
  }
}
