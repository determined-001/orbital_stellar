import { useState, useEffect } from "react";
import type { NormalizedEvent } from "@orbital/pulse-core";

// --- Types ---

export type UseEventConfig = {
  serverUrl: string;
  address: string;
  event?: string; // defaults to "*" — all events
  /** API key forwarded as ?token= query param — required when the server has authentication enabled */
  token?: string;
};

export type EventState = {
  event: NormalizedEvent | null;
  connected: boolean;
  error: string | null;
};

// --- useStellarEvent ---
// Core hook — two call signatures:
//
//   useStellarEvent(config: UseEventConfig)
//   useStellarEvent(serverUrl, address, options?)
//
// Prefer the primitives-first overload when writing inline call sites —
// it is stable by construction and never needs useMemo.

export function useStellarEvent(config: UseEventConfig): EventState;
export function useStellarEvent(
  serverUrl: string,
  address: string,
  options?: Pick<UseEventConfig, "event" | "token">
): EventState;
export function useStellarEvent(
  configOrUrl: UseEventConfig | string,
  address?: string,
  options?: Pick<UseEventConfig, "event" | "token">
): EventState {
  // Normalise the two call signatures down to four primitives.
  const serverUrl =
    typeof configOrUrl === "string" ? configOrUrl : configOrUrl.serverUrl;
  const addr =
    typeof configOrUrl === "string" ? address! : configOrUrl.address;
  const eventType =
    typeof configOrUrl === "string"
      ? options?.event ?? "*"
      : configOrUrl.event ?? "*";
  const token =
    typeof configOrUrl === "string"
      ? options?.token
      : configOrUrl.token;

  const [state, setState] = useState<EventState>({
    event: null,
    connected: false,
    error: null,
  });

  useEffect(() => {
    // Dep array references each primitive directly — object identity never
    // matters here, so an inline `{ serverUrl, address }` literal at the
    // call site is harmless for this hook (though the primitives overload
    // below is still cleaner).
    const base = `${serverUrl}/events/${addr}`;
    const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;

    const source = new EventSource(url);

    source.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    };

    source.onmessage = (e) => {
      try {
        const incoming: NormalizedEvent = JSON.parse(e.data);

        // Filter by event type if specified
        if (eventType !== "*" && incoming.type !== eventType) return;

        setState((prev) => ({ ...prev, event: incoming }));
      } catch {
        setState((prev) => ({ ...prev, error: "Failed to parse event" }));
      }
    };

    source.onerror = () => {
      setState((prev) => ({
        ...prev,
        connected: false,
        error: "Connection lost — retrying...",
      }));
    };

    return () => {
      source.close();
    };
    // ✅ Each dep is a primitive — safe from object-identity churn.
  }, [serverUrl, addr, eventType, token]);

  return state;
}

// --- useStellarPayment ---
// Convenience hook — only listens to payment events

export function useStellarPayment(serverUrl: string, address: string) {
  return useStellarEvent(serverUrl, address, { event: "payment.received" });
}

// --- useStellarActivity ---
// Convenience hook — listens to all events on an address

export function useStellarActivity(serverUrl: string, address: string) {
  return useStellarEvent(serverUrl, address, { event: "*" });
}
