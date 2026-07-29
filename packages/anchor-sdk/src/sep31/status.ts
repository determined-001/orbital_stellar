export type Sep31Status =
  | "pending_sender"
  | "pending_stellar"
  | "pending_customer_info_update"
  | "pending_transaction_info_update"
  | "pending_receiver"
  | "pending_external"
  | "completed"
  | "error";

export class Sep31StatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Sep31StatusError";
  }
}

export class MissingFieldsError extends Sep31StatusError {
  constructor(public readonly missingFields: Record<string, { description: string }>) {
    super("Missing required fields for SEP-31 transaction");
    this.name = "MissingFieldsError";
  }
}

/**
 * Validates a transition from one SEP-31 status to another.
 * Throws an error if the transition is invalid.
 */
export function validateTransition(current: Sep31Status, next: Sep31Status): void {
  // A terminal state cannot transition to any other state
  if (current === "completed" || current === "error") {
    throw new Sep31StatusError(`Cannot transition from terminal status '${current}' to '${next}'`);
  }

  // Self-transitions are valid (e.g. updating info while still pending)
  if (current === next) return;

  const validTransitions: Record<Sep31Status, Sep31Status[]> = {
    pending_sender: [
      "pending_customer_info_update",
      "pending_transaction_info_update",
      "pending_stellar",
      "error",
    ],
    pending_customer_info_update: [
      "pending_sender", // after providing info, it might go back to pending_sender for evaluation
      "pending_transaction_info_update",
      "pending_stellar",
      "error",
    ],
    pending_transaction_info_update: [
      "pending_sender",
      "pending_customer_info_update",
      "pending_stellar",
      "error",
    ],
    pending_stellar: ["pending_receiver", "pending_external", "completed", "error"],
    pending_receiver: ["pending_external", "completed", "error"],
    pending_external: ["completed", "error"],
    completed: [],
    error: [],
  };

  if (!validTransitions[current]?.includes(next)) {
    throw new Sep31StatusError(`Invalid transition from '${current}' to '${next}'`);
  }
}
