import type { NormalizedEvent } from "./index.js";

/**
 * Type guard to narrow a NormalizedEvent to one or more specific event types.
 *
 * Useful for filtering events by type in a type-safe way without needing
 * a full switch statement. Works with any combination of event type strings.
 *
 * @param event - The event to check
 * @param types - One or more event type strings to match against
 * @returns true if the event's type matches any of the provided types
 *
 * @example
 * // Narrow to a single type
 * if (isEventType(event, "payment.received")) {
 *   console.log(`Received ${event.amount} ${event.asset}`);
 * }
 *
 * @example
 * // Narrow to multiple types
 * if (isEventType(event, "payment.received", "payment.sent")) {
 *   console.log(`Payment of ${event.amount} ${event.asset}`);
 * }
 *
 * @example
 * // Filter an array of events
 * const payments = events.filter((e) =>
 *   isEventType(e, "payment.received", "payment.sent", "payment.self")
 * );
 */
export function isEventType<T extends NormalizedEvent["type"]>(
  event: NormalizedEvent,
  ...types: T[]
): event is Extract<NormalizedEvent, { type: T }> {
  return types.includes(event.type as T);
}
