import { useEffect, useRef } from "react";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";
import { acquireEventConnection } from "./connectionPool.js";
import type { UseEventConfig } from "./index.js";

// ---------------------------------------------------------------------------
// Suspense resource cache
//
// React Suspense works by catching a thrown Promise (a "thenable"). When the
// promise resolves, React re-renders the suspended subtree. We keep one cache
// entry per (serverUrl + address + eventKey + token) tuple so that:
//
//   1. First render → entry is "pending" → hook throws the promise →
//      Suspense shows the fallback.
//   2. First matching event arrives → promise resolves → React re-renders.
//   3. Subsequent renders → entry is "ready" → hook returns the event
//      synchronously (never null).
//   4. Last consumer unmounts → connection is released via the pool.
//
// The pool's own ref-counting (acquireEventConnection / unsubscribe) handles
// the underlying EventSource lifetime. The Suspense cache only tracks the
// promise/event state and its own subscriber count.
// ---------------------------------------------------------------------------

type ResourceStatus<T extends NormalizedEvent> =
  | { status: "pending"; promise: Promise<void>; resolve: () => void }
  | { status: "ready"; event: T };

type ResourceEntry<T extends NormalizedEvent> = {
  status: ResourceStatus<T>;
  /** Number of hook instances currently using this resource. */
  refCount: number;
};

// Keyed by the same tuple used by the connection pool.
const resourceCache = new Map<string, ResourceEntry<NormalizedEvent>>();

function buildResourceKey(
  serverUrl: string,
  address: string,
  eventKey: string,
  token: string | undefined,
): string {
  return JSON.stringify([serverUrl, address, eventKey, token ?? ""]);
}

function getOrCreateResource<T extends NormalizedEvent>(
  serverUrl: string,
  address: string,
  eventType: string | string[],
  token: string | undefined,
  resourceKey: string,
): ResourceEntry<T> {
  const existing = resourceCache.get(resourceKey);
  if (existing) return existing as ResourceEntry<T>;

  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  const entry: ResourceEntry<NormalizedEvent> = {
    status: { status: "pending", promise, resolve },
    refCount: 0,
  };

  resourceCache.set(resourceKey, entry);
  return entry as ResourceEntry<T>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * A [React Suspense](https://react.dev/reference/react/Suspense)-compatible
 * hook that throws a Promise until the first matching event arrives for the
 * given Stellar address.
 *
 * Wrap the consuming component in a `<Suspense>` boundary:
 *
 * ```tsx
 * "use client";
 * import { Suspense } from "react";
 * import { useStellarEventSuspense } from "@orbital-stellar/pulse-notify";
 *
 * function LiveBalance({ address }: { address: string }) {
 *   // Never returns null — component is suspended until data arrives.
 *   const event = useStellarEventSuspense(
 *     "https://events.example.com",
 *     address,
 *     { event: "payment.received" },
 *   );
 *   return <p>+{event.amount} {event.asset}</p>;
 * }
 *
 * export default function Page() {
 *   return (
 *     <Suspense fallback={<p>Waiting for first event…</p>}>
 *       <LiveBalance address="GABC..." />
 *     </Suspense>
 *   );
 * }
 * ```
 *
 * Also accepts a single config object — same shape as `useStellarEvent`.
 *
 * **Trade-offs**
 *
 * - The component is invisible until the first event arrives. For addresses
 *   that rarely receive events this can mean a long — or permanent — fallback.
 *   Prefer `useStellarEvent` when you want to render a loading skeleton or a
 *   "no events yet" state instead.
 * - You cannot render partial UI inside the suspended component; put loading
 *   UI in the `fallback` prop of `<Suspense>`.
 * - Pair with an `<ErrorBoundary>` to handle connection failures gracefully.
 * - Client-only: `EventSource` is not available in Node.js. Mark consuming
 *   components with `"use client"` in Next.js App Router.
 * - Multiple hook instances with the same arguments share one `EventSource`
 *   connection via the connection pool.
 *
 * @param serverUrl - Base URL of your Orbital-powered backend.
 * @param address   - Stellar address to watch.
 * @param options   - Optional event type filter and API token.
 * @returns The most recent matching event. Never `null`.
 */
export function useStellarEventSuspense<T extends NormalizedEvent = NormalizedEvent>(
  serverUrl: string,
  address: string,
  options?: Pick<UseEventConfig, "event" | "token">,
): T;

/** Overload that accepts a single config object. */
export function useStellarEventSuspense<T extends NormalizedEvent = NormalizedEvent>(
  config: UseEventConfig,
): T;

export function useStellarEventSuspense<T extends NormalizedEvent = NormalizedEvent>(
  configOrUrl: UseEventConfig | string,
  address?: string,
  options?: Pick<UseEventConfig, "event" | "token">,
): T {
  // Normalise the two call signatures.
  const serverUrl = typeof configOrUrl === "string" ? configOrUrl : configOrUrl.serverUrl;
  const addr = typeof configOrUrl === "string" ? address! : configOrUrl.address;
  const eventType: string | string[] =
    typeof configOrUrl === "string" ? (options?.event ?? "*") : (configOrUrl.event ?? "*");
  const token = typeof configOrUrl === "string" ? options?.token : configOrUrl.token;

  // Stable string key — same strategy as useStellarEvent.
  const eventKey = Array.isArray(eventType) ? [...eventType].sort().join(",") : eventType;

  const resourceKey = buildResourceKey(serverUrl, addr, eventKey, token);

  // Acquire or create the resource entry synchronously during render so the
  // thrown promise is available on the very first render pass.
  const entry = getOrCreateResource<T>(serverUrl, addr, eventType, token, resourceKey);

  // Track the resource key this instance is currently subscribed to so the
  // effect cleanup can release the right entry even if args change mid-life.
  const resourceKeyRef = useRef<string | null>(null);

  // Increment refCount once per (instance × resourceKey). We do this during
  // render (not inside useEffect) so the count is correct before the first
  // paint — important when StrictMode double-invokes render.
  if (resourceKeyRef.current !== resourceKey) {
    entry.refCount += 1;
    resourceKeyRef.current = resourceKey;
  }

  useEffect(() => {
    const currentKey = resourceKey;
    const currentEntry = resourceCache.get(currentKey) as ResourceEntry<T> | undefined;

    if (!currentEntry) return;

    // Subscribe to the shared connection pool. The pool manages the actual
    // EventSource lifetime; we only need to update the resource status here.
    const connection = acquireEventConnection(
      { serverUrl, address: addr, token },
      {
        onOpen: () => {
          // Connection open — nothing to do for Suspense state.
        },
        onEvent: (incoming) => {
          const allowed =
            eventType === "*" ||
            (Array.isArray(eventType)
              ? eventType.includes(incoming.type)
              : incoming.type === eventType);

          if (!allowed) return;

          if (currentEntry.status.status === "pending") {
            const { resolve } = currentEntry.status;
            currentEntry.status = { status: "ready", event: incoming as T };
            resolve();
          } else {
            // Already resolved — update the stored event for subsequent renders.
            currentEntry.status = { status: "ready", event: incoming as T };
          }
        },
        onParseError: () => {
          // Malformed message — stay suspended or keep the last good event.
        },
        onError: () => {
          // Connection error — stay suspended; browser will reconnect.
        },
      },
    );

    // If the connection was already open when we subscribed (e.g. shared pool
    // entry), there's nothing extra to do — we wait for the next event.

    return () => {
      connection.unsubscribe();

      // Release this instance's hold on the resource entry.
      const entryToRelease = resourceCache.get(currentKey);
      if (entryToRelease) {
        entryToRelease.refCount -= 1;
        if (entryToRelease.refCount <= 0) {
          resourceCache.delete(currentKey);
        }
      }
      resourceKeyRef.current = null;
    };
  }, [resourceKey]);

  // --- Suspense protocol ---
  // Throw the pending promise so React shows the nearest Suspense fallback.
  // When the promise resolves React re-renders and we fall through to the
  // return below.
  if (entry.status.status === "pending") {
    throw entry.status.promise;
  }

  return entry.status.event as T;
}
