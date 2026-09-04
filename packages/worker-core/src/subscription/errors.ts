/** Reasons a subscription operation is refused. Typed so a caller can branch. */
export type SubscriptionErrorCode =
  | "INVALID_WEBHOOK_TARGET"
  | "NOT_FOUND"
  | "ALREADY_CANCELLED"
  | "INVALID_TRANSITION"
  | "TIER_NOT_REGISTRABLE"
  | "INVALID_FIELD";

export class SubscriptionError extends Error {
  constructor(
    public readonly code: SubscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}
