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
  /**
   * Close EventSource connection when tab is hidden for this duration (ms).
   * Defaults to 30000 (30s). Set to 0 to disable.
   * Saves bandwidth and battery on mobile when tab is not visible.
   */
  hideAfterMs?: number;
};

export type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;
  connected: boolean;
  error: string | null;
  lastEventAt: string | null;
};

export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  config: UseEventConfig<T>,
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: Pick<
    UseEventConfig<T>,
    | "event"
    | "token"
    | "initialEvent"
    | "filter"
    | "withCredentials"
    | "onEvent"
    | "hideAfterMs"
  >,
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  configOrUrl: UseEventConfig<T> | string,
  address?: string,
  options?: Pick<
    UseEventConfig<T>,
    | "event"
    | "token"
    | "initialEvent"
    | "filter"
    | "withCredentials"
    | "onEvent"
    | "hideAfterMs"
  >,
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
  const hideAfterMs =
    typeof configOrUrl === "string"
      ? (options?.hideAfterMs ?? 30000)
      : (configOrUrl.hideAfterMs ?? 30000);

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

          setState((prev) => ({
            ...prev,
            event: incoming as T,
            lastEventAt: incoming.timestamp ?? null,
          }));
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
      },
    );

    if (connection.connected) {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    }

    // Handle tab visibility — close connection when hidden for > hideAfterMs
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const handleVisibilityChange = () => {
      if (hideAfterMs === 0) return; // Disabled

      if (document.visibilityState === "hidden") {
        // Tab is now hidden — start timer to close connection
        hideTimer = setTimeout(() => {
          connection.close();
        }, hideAfterMs);
      } else {
        // Tab is now visible — cancel timer and re-establish if needed
        if (hideTimer) {
          clearTimeout(hideTimer);
          hideTimer = undefined;
        }
        connection.reopenIfClosed();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
      connection.unsubscribe();
    };
    // ✅ eventKey is a serialised string — stable even when the caller passes
    // an array literal, which would otherwise be a new reference every render.
  }, [serverUrl, addr, eventKey, token, withCredentials, hideAfterMs]);

  return state;
}

export type PaymentEvent = Extract<NormalizedEvent, { type: "payment.received" }>;

export function useStellarPayment(
  serverUrl: string,
  address: string,
  options?: {
    initialEvent?: PaymentEvent | null;
    filter?: (event: NormalizedEvent) => boolean;
    withCredentials?: boolean;
    hideAfterMs?: number;
  },
) {
  const base = useStellarEvent<PaymentEvent>(serverUrl, address, {
    event: "payment.received",
    initialEvent: options?.initialEvent,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
    hideAfterMs: options?.hideAfterMs,
  });
  const amountStroop: bigint | null =
    base.event?.amount != null
      ? BigInt(Math.round(parseFloat(base.event.amount) * 10_000_000))
      : null;
  return { ...base, amountStroop };
}

export function useStellarActivity(
  serverUrl: string,
  address: string,
  options?: {
    initialEvent?: NormalizedEvent | null;
    filter?: (event: NormalizedEvent) => boolean;
    withCredentials?: boolean;
    hideAfterMs?: number;
  },
) {
  return useStellarEvent(serverUrl, address, {
    event: "*",
    initialEvent: options?.initialEvent,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
    hideAfterMs: options?.hideAfterMs,
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
  options?: UseHistoryOptions,
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
