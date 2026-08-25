/** Adds the lazy, non-enumerable `timestampDate` getter to an event type. */
export type Timestamped<T> = T & { readonly timestampDate: Date };

/**
 * Attaches a non-enumerable lazy getter `timestampDate` to an event object.
 * The Date is parsed from `event.timestamp` on first access and cached.
 * JSON.stringify output is unaffected because the property is non-enumerable.
 */
export function withTimestampDate<T extends { timestamp: string }>(event: T): Timestamped<T> {
  let cached: Date | undefined;
  Object.defineProperty(event, "timestampDate", {
    enumerable: false,
    configurable: true,
    get(): Date {
      if (cached === undefined) cached = new Date(event.timestamp);
      return cached;
    },
  });
  return event as Timestamped<T>;
}
