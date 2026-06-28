import { useState, useEffect, useRef } from "react";

import { acquireEventConnection, acquireContractEventConnection } from "./connectionPool.js";
import type {
  NormalizedEvent,
  PaymentEvent,
  ContractEmittedEvent,
} from "@orbital-stellar/pulse-core";
import { acquireWsConnection } from "./wsTransport.js";
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
  /** Transport to use. Defaults to 'sse'. */
  transport?: "sse" | "websocket";
  /** Wait time before pausing active connection when document becomes hidden (ms). Defaults to 30000. */
  hideAfterMs?: number;
};

export type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;
  connected: boolean;
  error: string | null;
  lastEventAt: string | null;
};

function useVisibilityState(hideAfterMs = 30000): boolean {
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let timer: any = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        timer = setTimeout(() => {
          setIsActive(false);
        }, hideAfterMs);
      } else {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        setIsActive(true);
      }
    };

    if (document.visibilityState === "hidden") {
      timer = setTimeout(() => {
        setIsActive(false);
      }, hideAfterMs);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hideAfterMs]);

  return isActive;
}

export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  config: UseEventConfig<T>,
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: Pick<
    UseEventConfig<T>,
    "event" | "token" | "initialEvent" | "filter" | "withCredentials" | "onEvent" | "hideAfterMs"
  >,
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  configOrUrl: UseEventConfig<T> | string,
  address?: string,
  options?: Pick<
    UseEventConfig<T>,
    "event" | "token" | "initialEvent" | "filter" | "withCredentials" | "onEvent" | "hideAfterMs"
  >,
): EventState<T> {
  const serverUrl = typeof configOrUrl === "string" ? configOrUrl : configOrUrl.serverUrl;
  const addr = typeof configOrUrl === "string" ? address! : configOrUrl.address;
  const eventType: string | string[] =
    typeof configOrUrl === "string" ? (options?.event ?? "*") : (configOrUrl.event ?? "*");
  const token = typeof configOrUrl === "string" ? options?.token : configOrUrl.token;
  const initialEvent: T | null =
    (typeof configOrUrl === "string" ? options?.initialEvent : configOrUrl.initialEvent) ?? null;
  const filter = typeof configOrUrl === "string" ? options?.filter : configOrUrl.filter;
  const withCredentials =
    typeof configOrUrl === "string" ? options?.withCredentials : configOrUrl.withCredentials;
  const onEvent = typeof configOrUrl === "string" ? options?.onEvent : configOrUrl.onEvent;
  const transport = typeof configOrUrl === "string" ? "sse" : (configOrUrl.transport ?? "sse");
  const hideAfterMs =
    typeof configOrUrl === "string" ? options?.hideAfterMs : configOrUrl.hideAfterMs;

  const eventKey = Array.isArray(eventType) ? [...eventType].sort().join(",") : eventType;

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

  const isActive = useVisibilityState(hideAfterMs ?? 30000);

  useEffect(() => {
    if (!isActive) {
      setState((prev) => ({ ...prev, connected: false }));
      return;
    }

    const acquire = transport === "websocket" ? acquireWsConnection : acquireEventConnection;
    const connection = acquire(
      { serverUrl, address: addr, token, ...(transport === "sse" ? { withCredentials } : {}) },
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

    return () => {
      connection.unsubscribe();
    };
    // ✅ eventKey is a serialised string — stable even when the caller passes
    // an array literal, which would otherwise be a new reference every render.
  }, [serverUrl, addr, eventKey, token, withCredentials, transport, isActive]);

  return state;
}

// Re-export pulse-core's PaymentEvent. (It cannot be derived via
// `Extract<NormalizedEvent, ...>` because NormalizedEvent is an intersection
// with `{ timestampDate }`, over which Extract does not distribute.)
export type { PaymentEvent };

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
    return BigInt(whole ?? "0") * 10_000_000n + BigInt(fracPadded);
  } catch {
    return null;
  }
}

export type PaymentState = {
  event: PaymentEvent | null;
  connected: boolean;
  error: string | null;
  lastEventAt: string | null;
  amountStroop: bigint | null;
};

export function useStellarPayment(
  serverUrl: string,
  address: string,
  options?: {
    initialEvent?: PaymentEvent | null;
    filter?: (event: NormalizedEvent) => boolean;
    withCredentials?: boolean;
    hideAfterMs?: number;
  },
): PaymentState {
  const base = useStellarEvent(serverUrl, address, {
    event: "payment.received",
    initialEvent: (options?.initialEvent ?? undefined) as NormalizedEvent | undefined,
    filter: options?.filter,
    withCredentials: options?.withCredentials,
    hideAfterMs: options?.hideAfterMs,
  });
  // The "payment.received" stream only ever delivers PaymentEvents; narrow the
  // generic NormalizedEvent so we can read `amount`.
  const paymentEvent = (base.event ?? null) as PaymentEvent | null;
  const amountStroop: bigint | null =
    paymentEvent?.amount != null ? amountToStroop(paymentEvent.amount) : null;
  return { ...base, event: paymentEvent, amountStroop };
}

export function useStellarActivity<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: {
    initialEvent?: T | null;
    filter?: (event: NormalizedEvent) => boolean;
    withCredentials?: boolean;
    hideAfterMs?: number;
  },
): EventState<T> {
  return useStellarEvent<T>(serverUrl, address, {
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
export { StellarEventBoundary } from "./StellarEventBoundary.js";

export type UseContractEventConfig<T extends NormalizedEvent = NormalizedEvent> = {
  serverUrl: string;
  contractId: string;
  topics?: string[];
  token?: string;
  /** SSR initial state; replaced on first live event */
  initialEvent?: T | null;
  /** Client-side predicate; events that return false are suppressed before state update */
  filter?: (event: NormalizedEvent) => boolean;
  /** Enable cookie-based auth for same-origin or CORS-credentialed SSE */
  withCredentials?: boolean;
  /** Side-effect callback fired for every incoming event, before filter is applied */
  onEvent?: (event: NormalizedEvent) => void;
  /** Wait time before pausing active connection when document becomes hidden (ms). Defaults to 30000. */
  hideAfterMs?: number;
};

/** Hook for subscribing to Soroban contract events */
export function useContractEvent<
  T extends Extract<NormalizedEvent, { type: "contract.invoked" | "contract.emitted" }> = Extract<
    NormalizedEvent,
    { type: "contract.invoked" | "contract.emitted" }
  >,
>(config: UseContractEventConfig<T>): EventState<T> {
  const {
    serverUrl,
    contractId,
    topics,
    token,
    initialEvent,
    filter,
    withCredentials,
    onEvent,
    hideAfterMs,
  } = config;

  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const [state, setState] = useState<EventState<T>>({
    event: initialEvent ?? null,
    connected: false,
    error: null,
    lastEventAt: null,
  });

  const isActive = useVisibilityState(hideAfterMs ?? 30000);

  useEffect(() => {
    if (!isActive) {
      setState((prev) => ({ ...prev, connected: false }));
      return;
    }

    const connection = acquireContractEventConnection(
      { serverUrl, contractId, topics, token, withCredentials },
      {
        onOpen: () => {
          setState((prev) => ({ ...prev, connected: true, error: null }));
        },
        onEvent: (incoming) => {
          onEventRef.current?.(incoming);
          // Basic topic filtering for emitted events
          if (incoming.type === "contract.emitted" && topics && topics.length > 0) {
            const ev = incoming as ContractEmittedEvent;
            const matches = topics.every((t) => ev.topics.includes(t));
            if (!matches) return;
          }
          // Apply user filter if provided
          if (filterRef.current && !filterRef.current(incoming)) return;
          // Narrow to requested generic type
          setState((prev) => ({
            ...prev,
            event: incoming as unknown as T,
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

    return () => {
      connection.unsubscribe();
    };
  }, [serverUrl, contractId, JSON.stringify(topics ?? []), token, withCredentials, isActive]);

  return state;
}

export type { PulseNotifyVitePlugin } from "./vitePlugin.js";

export {
  useContractState,
  type ContractStateOptions,
  type ContractStateResult,
} from "./useContractState.js";

export type UseHistoryOptions<T extends NormalizedEvent = NormalizedEvent> = {
  token?: string;
  /** Maximum number of events to retain in FIFO order. Defaults to 100. */
  capacity?: number;
  /** SSR initial event to seed history */
  initialEvent?: T | null;
  hideAfterMs?: number;
};

export type HistoryState<T extends NormalizedEvent = NormalizedEvent> = EventState<T> & {
  history: T[];
};

// ─── useStellarAddresses ─────────────────────────────────────────────────────

export type UseAddressesOptions = {
  event?: string | string[];
  token?: string;
  /** Client-side predicate; events that return false are suppressed before state update */
  filter?: (event: NormalizedEvent) => boolean;
  /** Enable cookie-based auth for same-origin or CORS-credentialed SSE */
  withCredentials?: boolean;
  /** Side-effect callback fired for every incoming event (per address), before filter is applied */
  onEvent?: (address: string, event: NormalizedEvent) => void;
};

/**
 * Watches multiple Stellar addresses with a single hook call.
 *
 * Connections are acquired from the shared pool (see connectionPool.ts), so
 * duplicate addresses across the same `serverUrl`/`token` combination always
 * reuse one underlying EventSource rather than opening a new one.
 *
 * @param serverUrl - Base URL of the pulse-notify server.
 * @param addresses - Array of Stellar account addresses to watch.
 * @param options   - Optional shared configuration (token, filter, …).
 * @returns A `Record<address, EventState<T>>` that is updated independently
 *          for each address as events arrive.
 *
 * @example
 * const states = useStellarAddresses(serverUrl, [addrA, addrB, addrC]);
 * // states[addrA].event, states[addrB].connected, …
 */
export function useStellarAddresses<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  addresses: string[],
  options?: UseAddressesOptions,
): Record<string, EventState<T>> {
  const { event: eventType, token, filter, withCredentials, onEvent } = options ?? {};

  // Serialise the addresses array once per render so we can use it as a stable
  // effect dependency even when the caller passes an inline literal.
  const addressKey = [...addresses].sort().join(",");
  const eventKey = Array.isArray(eventType) ? [...eventType].sort().join(",") : (eventType ?? "*");

  // Initialise state lazily — one EventState entry per address.
  const [states, setStates] = useState<Record<string, EventState<T>>>(() => {
    const initial: Record<string, EventState<T>> = {};
    for (const addr of addresses) {
      initial[addr] = { event: null, connected: false, error: null, lastEventAt: null };
    }
    return initial;
  });

  // Keep callbacks in refs so that effect deps stay stable across renders.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  });

  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (addresses.length === 0) return;

    // Normalise the event-type list once for all subscriptions.
    const resolvedEventType: string | string[] = eventKey === "*" ? "*" : (eventType ?? "*");

    const connections = addresses.map((addr) => {
      const connection = acquireEventConnection(
        { serverUrl, address: addr, token, withCredentials },
        {
          onOpen: () => {
            setStates((prev) => ({
              ...prev,
              [addr]: { ...prev[addr]!, connected: true, error: null },
            }));
          },
          onEvent: (incoming) => {
            onEventRef.current?.(addr, incoming);

            // Apply event-type filter.
            const allowed =
              resolvedEventType === "*" ||
              (Array.isArray(resolvedEventType)
                ? resolvedEventType.includes(incoming.type)
                : incoming.type === resolvedEventType);
            if (!allowed) return;

            // Apply user predicate.
            if (filterRef.current && !filterRef.current(incoming)) return;

            setStates((prev) => ({
              ...prev,
              [addr]: {
                ...prev[addr]!,
                event: incoming as T,
                lastEventAt: incoming.timestamp ?? null,
              },
            }));
          },
          onParseError: () => {
            setStates((prev) => ({
              ...prev,
              [addr]: { ...prev[addr]!, error: "Failed to parse event" },
            }));
          },
          onError: () => {
            setStates((prev) => ({
              ...prev,
              [addr]: {
                ...prev[addr]!,
                connected: false,
                error: "Connection lost — retrying...",
              },
            }));
          },
        },
      );

      // If the pool already had an open connection, reflect that immediately.
      if (connection.connected) {
        setStates((prev) => ({
          ...prev,
          [addr]: { ...prev[addr]!, connected: true, error: null },
        }));
      }

      return connection;
    });

    return () => {
      for (const connection of connections) {
        connection.unsubscribe();
      }
    };
    // ✅ addressKey and eventKey are stable serialised strings — safe as deps
    // even when the caller passes inline array literals.
  }, [serverUrl, addressKey, eventKey, token, withCredentials]);

  return states;
}

// ─────────────────────────────────────────────────────────────────────────────

export function useStellarHistory<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: UseHistoryOptions<T>,
): HistoryState<T> {
  const capacity = options?.capacity ?? 100;
  const base = useStellarActivity<T>(serverUrl, address, {
    initialEvent: options?.initialEvent ?? null,
    hideAfterMs: options?.hideAfterMs,
  });
  const [history, setHistory] = useState<T[]>(options?.initialEvent ? [options.initialEvent] : []);

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
