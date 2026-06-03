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
  /** SSR initial state; replaced on first live event */
  initialEvent?: T | null;
  /** Client-side predicate; events that return false are suppressed before state update */
  filter?: (event: NormalizedEvent) => boolean;
  /** Enable cookie-based auth for same-origin or CORS-credentialed SSE */
  withCredentials?: boolean;
  /** Side-effect callback fired for every incoming event, before filter is applied */
  onEvent?: (event: NormalizedEvent) => void;
};

export type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;
  connected: boolean;
  error: string | null;
  lastEventAt: string | null;
};

export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  config: UseEventConfig<T>
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: Pick<
    UseEventConfig<T>,
    "event" | "token" | "initialEvent" | "filter" | "withCredentials" | "onEvent"
  >
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  configOrUrl: UseEventConfig<T> | string,
  address?: string,
  options?: Pick<
    UseEventConfig<T>,
    "event" | "token" | "initialEvent" | "filter" | "withCredentials" | "onEvent"
  >
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

  const eventKey = Array.isArray(eventType)
    ? [...eventType].sort().join(",")
    : eventType;

  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  const [state, setState] = useState<EventState<T>>({
    event: initialEvent,
    connected: false,
    error: null,
    lastEventAt: null,
  });

  useEffect(() => {
    const connection = acquireEventConnection(
      { serverUrl, address: addr, token, withCredentials },
      {
        onOpen: () => {
          setState((prev) => ({ ...prev, connected: true, error: null }));
        },
        onEvent: (incoming) => {
          onEventRef.current?.(incoming);

          const allowed =
            eventType === "*" ||
            (Array.isArray(eventType)
              ? eventType.includes(incoming.type)
              : incoming.type === eventType);

          if (!allowed) return;
          if (filterRef.current && !filterRef.current(incoming)) return;

          setState((prev) => ({ ...prev, event: incoming as T, lastEventAt: incoming.timestamp ?? null }));
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
    // ✅ eventKey is a serialised string — stable even when the caller passes
    // an array literal, which would otherwise be a new reference every render.
  }, [serverUrl, addr, eventKey, token, withCredentials]);

  return state;
}

export type PaymentEvent = Extract<NormalizedEvent, { type: "payment.received" }>;

/**
 * Converts a Stellar decimal amount string (e.g. "12.3456789") to stroops
 * (1 XLM = 10,000,000 stroops) as a bigint.
 *
 * Uses integer arithmetic only — no parseFloat, no floating-point rounding.
 * Returns null if the string is not a valid non-negative decimal number.
 */
function amountToStroop(amount: string): bigint | null {
  if (!/^\d+(\.\d+)?$/.test(amount)) return null;
  const [whole, frac = ""] = amount.split(".");
  const fracPadded = frac.slice(0, 7).padEnd(7, "0");
  try {
    return BigInt(whole) * 10_000_000n + BigInt(fracPadded);
  } catch {
    return null;
  }
}

export function useStellarPayment(
  serverUrl: string,
  address: string,
  options?: {
    initialEvent?: PaymentEvent | null;
    filter?: (event: NormalizedEvent) => boolean;
    withCredentials?: boolean;
  }
) {
  const base = useStellarEvent<PaymentEvent>(serverUrl, address, {
    event: "payment.received",
    initialEvent: options?.initialEvent,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
  });
  const amountStroop: bigint | null =
    base.event?.amount != null ? amountToStroop(base.event.amount) : null;
  return { ...base, amountStroop };
}

export function useStellarActivity(
  serverUrl: string,
  address: string,
  options?: {
    initialEvent?: NormalizedEvent | null;
    filter?: (event: NormalizedEvent) => boolean;
    withCredentials?: boolean;
  }
) {
  return useStellarEvent(serverUrl, address, {
    event: "*",
    initialEvent: options?.initialEvent,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
  });
}

export {
  StellarConnectionStatus,
  type StellarConnectionStatusLabels,
  type StellarConnectionStatusProps,
  type StellarConnectionStatusState,
} from "./StellarConnectionStatus.js";

export type UseHistoryOptions = {
  token?: string;
  /** Maximum number of events to retain in FIFO order. Defaults to 100. */
  capacity?: number;
};

export type HistoryState<T extends NormalizedEvent = NormalizedEvent> = EventState<T> & {
  history: T[];
};

export function useStellarHistory<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: UseHistoryOptions
): HistoryState<T> {
  const [history, setHistory] = useState<T[]>([]);
  const capacity = options?.capacity ?? 100;
  const base = useStellarActivity<T>(serverUrl, address, { initialEvent: null });

  useEffect(() => {
    if (base.event) {
      setHistory((prev) => {
        const next = [...prev, base.event as T];
        return next.length > capacity ? next.slice(next.length - capacity) : next;
      });
    }
  }, [base.event, capacity]);

  return { ...base, history };
}
