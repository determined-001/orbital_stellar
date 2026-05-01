import { useState, useEffect } from "react";
import type { NormalizedEvent } from "@orbital/pulse-core";

// --- Types ---

export type UseEventConfig = {
  serverUrl: string;
  address: string;
  event?: string | string[]; // "*" = all events; array = allowlist of types
  /** API key forwarded as ?token= query param — required when the server has authentication enabled */
  token?: string;
};

export type EventState<T extends NormalizedEvent = NormalizedEvent> = {
  event: T | null;
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

export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  config: UseEventConfig
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: Pick<UseEventConfig, "event" | "token">
): EventState<T>;
export function useStellarEvent<T extends NormalizedEvent = NormalizedEvent>(
  configOrUrl: UseEventConfig | string,
  address?: string,
  options?: Pick<UseEventConfig, "event" | "token">
): EventState<T> {
  // Normalise the two call signatures down to four primitives.
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

  // Serialise eventType to a stable string for the dep array.
  // An array literal passed by the caller would otherwise be a new reference
  // every render and re-run the effect continuously.
  const eventKey = Array.isArray(eventType)
    ? [...eventType].sort().join(",")
    : eventType;

  const [state, setState] = useState<EventState<T>>({
    event: null,
    connected: false,
    error: null,
  });

  useEffect(() => {
    const base = `${serverUrl}/events/${addr}`;
    const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;

    const source = new EventSource(url);

    source.onopen = () => {
      setState((prev) => ({ ...prev, connected: true, error: null }));
    };

    source.onmessage = (e) => {
      try {
        const incoming: NormalizedEvent = JSON.parse(e.data);

        // Filter by event type: pass if "*", if type matches the string,
        // or if type is included in the allowlist array.
        const allowed =
          eventType === "*" ||
          (Array.isArray(eventType)
            ? eventType.includes(incoming.type)
            : incoming.type === eventType);

        if (!allowed) return;

        setState((prev) => ({ ...prev, event: incoming as T }));
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
    // ✅ eventKey is a serialised string — stable even when the caller passes
    // an array literal, which would otherwise be a new reference every render.
  }, [serverUrl, addr, eventKey, token]);

  return state;
}

// --- useStellarPayment ---
// Convenience hook — only listens to payment events

export function useStellarPayment(serverUrl: string, address: string) {
  return useStellarEvent<Extract<NormalizedEvent, { type: "payment.received" }>>(
    serverUrl,
    address,
    { event: "payment.received" }
  );
}

// --- useStellarActivity ---
// Convenience hook — listens to all events on an address

export function useStellarActivity(serverUrl: string, address: string) {
  return useStellarEvent(serverUrl, address, { event: "*" });
}
