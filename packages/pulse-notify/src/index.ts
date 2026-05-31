import { useState, useEffect, useRef } from "react";
import type { NormalizedEvent } from "@orbital/pulse-core";
import { acquireEventConnection } from "./connectionPool.js";
export { useStellarEventSuspense } from "./useStellarEventSuspense.js";

export type UseEventConfig<T extends NormalizedEvent = NormalizedEvent> = {
  serverUrl: string;
  address: string;
  event?: string | string[];
  /** API key forwarded as ?token= query param — required when the server has authentication enabled */
  token?: string;
<<<<<<< HEAD
  filter?: (event: NormalizedEvent) => boolean;
=======
  /** SSR initial state; replaced on first live event */
  initialEvent?: T | null;
  /** Client-side predicate; events that return false are suppressed before state update */
  filter?: (event: NormalizedEvent) => boolean;
  /** Enable cookie-based auth for same-origin or CORS-credentialed SSE */
  withCredentials?: boolean;
  /** Side-effect callback fired for every incoming event, before filter is applied */
  onEvent?: (event: NormalizedEvent) => void;
>>>>>>> upstream/main
};

export type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;
  connected: boolean;
  error: string | null;
};

export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  config: UseEventConfig<T>
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
<<<<<<< HEAD
  options?: Pick<UseEventConfig, "event" | "token" | "filter">
=======
  options?: Pick<UseEventConfig<T>, "event" | "token" | "initialEvent" | "filter" | "withCredentials" | "onEvent">
>>>>>>> upstream/main
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  configOrUrl: UseEventConfig<T> | string,
  address?: string,
<<<<<<< HEAD
  options?: Pick<UseEventConfig, "event" | "token" | "filter">
=======
  options?: Pick<UseEventConfig<T>, "event" | "token" | "initialEvent" | "filter" | "withCredentials" | "onEvent">
>>>>>>> upstream/main
): EventState<T> {
  const serverUrl =
    typeof configOrUrl === "string" ? configOrUrl : configOrUrl.serverUrl;
  const addr =
    typeof configOrUrl === "string" ? address! : configOrUrl.address;
  const eventType: string | string[] =
    typeof configOrUrl === "string"
      ? options?.event ?? "*"
      : configOrUrl.event ?? "*";
  const token =
<<<<<<< HEAD
    typeof configOrUrl === "string" ? options?.token : configOrUrl.token;
  const filter =
    typeof configOrUrl === "string" ? options?.filter : configOrUrl.filter;
=======
    typeof configOrUrl === "string"
      ? options?.token
      : configOrUrl.token;
  const initialEvent: T | null =
    (typeof configOrUrl === "string"
      ? options?.initialEvent
      : configOrUrl.initialEvent) ?? null;
  const filter =
    typeof configOrUrl === "string" ? options?.filter : configOrUrl.filter;
  const withCredentials =
    typeof configOrUrl === "string"
      ? options?.withCredentials
      : configOrUrl.withCredentials;
  const onEvent =
    typeof configOrUrl === "string" ? options?.onEvent : configOrUrl.onEvent;

  const filterRef = useRef(filter);
  useEffect(() => { filterRef.current = filter; });
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; });
>>>>>>> upstream/main

  const eventKey = Array.isArray(eventType)
    ? [...eventType].sort().join(",")
    : eventType;

  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });

  const [state, setState] = useState<EventState<T>>({
    event: initialEvent,
    connected: false,
    error: null,
  });

  useEffect(() => {
    const connection = acquireEventConnection(
      { serverUrl, address: addr, token, withCredentials },
      {
        onOpen: () => {
          setState((prev) => ({ ...prev, connected: true, error: null }));
        },
        onEvent: (incoming) => {
<<<<<<< HEAD
=======
          onEventRef.current?.(incoming);

          // Filter by event type: pass if "*", if type matches the string,
          // or if type is included in the allowlist array.
>>>>>>> upstream/main
          const allowed =
            eventType === "*" ||
            (Array.isArray(eventType)
              ? eventType.includes(incoming.type)
              : incoming.type === eventType);

          if (!allowed) return;
          if (filterRef.current && !filterRef.current(incoming)) return;

          setState((prev) => ({ ...prev, event: incoming as T }));
        },
        onParseError: () => {
          setState((prev) => ({ ...prev, error: "Failed to parse event" }));
        },
        onError: () => {
          setState((prev) => ({
            ...prev,
            connected: false,
            error: "Connection lost — retrying...",
          }));
        },
      }
    );

    if (connection.connected) {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    }

    return () => {
      connection.unsubscribe();
    };
<<<<<<< HEAD
  }, [serverUrl, addr, eventKey, token]);
=======
    // ✅ eventKey is a serialised string — stable even when the caller passes
    // an array literal, which would otherwise be a new reference every render.
  }, [serverUrl, addr, eventKey, token, withCredentials]);

>>>>>>> upstream/main

  return state;
}

<<<<<<< HEAD
export function useStellarPayment(
  serverUrl: string,
  address: string,
  options?: Pick<UseEventConfig, "filter">
) {
  return useStellarEvent<Extract<NormalizedEvent, { type: "payment.received" }>>(
    serverUrl,
    address,
    { event: "payment.received", ...options }
  );
=======
type PaymentEvent = Extract<NormalizedEvent, { type: "payment.received" }>;

export function useStellarPayment(
  serverUrl: string,
  address: string,
  options?: { initialEvent?: PaymentEvent | null; filter?: (event: NormalizedEvent) => boolean; withCredentials?: boolean }
) {
  const base = useStellarEvent<PaymentEvent>(serverUrl, address, {
    event: "payment.received",
    initialEvent: options?.initialEvent,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
  });
  const amountStroop: bigint | null =
    base.event?.amount != null
      ? BigInt(Math.round(parseFloat(base.event.amount) * 10_000_000))
      : null;
  return { ...base, amountStroop };
>>>>>>> upstream/main
}

export function useStellarActivity(
  serverUrl: string,
  address: string,
<<<<<<< HEAD
  options?: Pick<UseEventConfig, "filter">
) {
  return useStellarEvent(serverUrl, address, { event: "*", ...options });
=======
  options?: { initialEvent?: NormalizedEvent | null; filter?: (event: NormalizedEvent) => boolean; withCredentials?: boolean }
) {
  return useStellarEvent(serverUrl, address, {
    event: "*",
    initialEvent: options?.initialEvent,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
  });
>>>>>>> upstream/main
}

export {
  StellarConnectionStatus,
  type StellarConnectionStatusLabels,
  type StellarConnectionStatusProps,
  type StellarConnectionStatusState,
} from "./StellarConnectionStatus.js";
