import { useEffect, useRef } from "react";
import type { NormalizedEvent } from "@orbital/pulse-core";
import type { UseEventConfig } from "./index.js";

// ---------------------------------------------------------------------------
// Suspense-compatible cache
//
// React Suspense works by catching a thrown Promise (a "thenable"). When the
// promise resolves, React re-renders the suspended subtree. We keep one cache
// entry per (serverUrl + address + eventKey) tuple so that:
//
//   1. The first render throws the pending promise → Suspense shows fallback.
//   2. When the first event arrives the promise resolves → React re-renders.
//   3. Subsequent renders return the cached event synchronously.
//   4. The cache entry is removed when the last subscriber unmounts.
// ---------------------------------------------------------------------------

type CacheStatus =
  | { status: "pending"; promise: Promise<void>; resolve: () => void }
  | { status: "ready"; event: NormalizedEvent };

type CacheEntry = {
  data: CacheStatus;
  /** Number of hook instances currently subscribed to this cache key. */
  refCount: number;
  /** The EventSource opened for this cache key. */
  source: EventSource;
  /** Latest event stored so re-renders after the first one are synchronous. */
  latestEvent: NormalizedEvent | null;
};

const cache = new Map<string, CacheEntry>();

function buildCacheKey(
  serverUrl: string,
  address: string,
  eventKey: string,
  token: string | undefined
): string {
  return `${serverUrl}|${address}|${eventKey}|${token ?? ""}`;
}

function openEntry(
  serverUrl: string,
  address: string,
  eventType: string | string[],
  token: string | undefined,
  cacheKey: string
): CacheEntry {
  const base = `${serverUrl}/events/${address}`;
  const url = token ? `${base}?token=${encodeURIComponent(token)}` : base;

  const source = new EventSource(url);

  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  const entry: CacheEntry = {
    data: { status: "pending", promise, resolve },
    refCount: 0,
    source,
    latestEvent: null,
  };

  source.onmessage = (e) => {
    try {
      const incoming: NormalizedEvent = JSON.parse(e.data);

      const allowed =
        eventType === "*" ||
        (Array.isArray(eventType)
          ? eventType.includes(incoming.type)
          : incoming.type === eventType);

      if (!allowed) return;

      entry.latestEvent = incoming;

      if (entry.data.status === "pending") {
        const { resolve: res } = entry.data;
        entry.data = { status: "ready", event: incoming };
        res();
      } else {
        // Already resolved — just update the stored event so the next render
        // picks up the latest value synchronously.
        entry.data = { status: "ready", event: incoming };
      }
    } catch {
      // Malformed message — ignore; the component stays suspended or keeps
      // the last good event.
    }
  };

  cache.set(cacheKey, entry);
  return entry;
}

function releaseEntry(cacheKey: string): void {
  const entry = cache.get(cacheKey);
  if (!entry) return;

  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.source.close();
    cache.delete(cacheKey);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * A Suspense-compatible hook that throws a Promise until the first matching
 * event arrives for the given Stellar address.
 *
 * **Usage**
 *
 * Wrap the consuming component in a `<Suspense>` boundary:
 *
 * ```tsx
 * import { Suspense } from "react";
 * import { useStellarEventSuspense } from "@orbital/pulse-notify";
 *
 * function LiveBalance({ address }: { address: string }) {
 *   // Throws until the first event — never returns null.
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
 * **Trade-offs**
 *
 * - The component is invisible until the first event arrives. For addresses
 *   that rarely receive events this can mean a long (or permanent) fallback.
 *   Prefer {@link useStellarEvent} when you want to render a loading skeleton
 *   or a "no events yet" state instead.
 * - Each unique (serverUrl, address, eventKey) tuple opens one `EventSource`
 *   connection. Multiple hook instances with the same arguments share a single
 *   connection via an internal cache.
 * - The hook is client-only — `EventSource` is not available in Node.js.
 *   Mark consuming components with `"use client"` in Next.js App Router.
 *
 * @param serverUrl - Base URL of your Orbital-powered backend.
 * @param address   - Stellar address to watch.
 * @param options   - Optional event type filter and API token.
 * @returns The most recent matching {@link NormalizedEvent}. Never `null` —
 *          the component is suspended until the first event arrives.
 */
export function useStellarEventSuspense<
  T extends NormalizedEvent = NormalizedEvent,
>(
  serverUrl: string,
  address: string,
  options?: Pick<UseEventConfig, "event" | "token">
): T;

/**
 * Overload that accepts a single config object.
 */
export function useStellarEventSuspense<
  T extends NormalizedEvent = NormalizedEvent,
>(config: UseEventConfig): T;

export function useStellarEventSuspense<
  T extends NormalizedEvent = NormalizedEvent,
>(
  configOrUrl: UseEventConfig | string,
  address?: string,
  options?: Pick<UseEventConfig, "event" | "token">
): T {
  // Normalise the two call signatures.
  const serverUrl =
    typeof configOrUrl === "string" ? configOrUrl : configOrUrl.serverUrl;
  const addr =
    typeof configOrUrl === "string" ? address! : configOrUrl.address;
  const eventType: string | string[] =
    typeof configOrUrl === "string"
      ? options?.event ?? "*"
      : configOrUrl.event ?? "*";
  const token =
    typeof configOrUrl === "string" ? options?.token : configOrUrl.token;

  // Stable string key for the dep array and cache lookup.
  const eventKey = Array.isArray(eventType)
    ? [...eventType].sort().join(",")
    : eventType;

  const cacheKey = buildCacheKey(serverUrl, addr, eventKey, token);

  // We need a ref to track the cache key used during the current render so
  // the cleanup effect can release the correct entry even if the key changes.
  const cacheKeyRef = useRef<string>(cacheKey);

  // Acquire / create the cache entry synchronously during render so the
  // thrown promise is available on the very first render.
  let entry = cache.get(cacheKey);
  if (!entry) {
    entry = openEntry(serverUrl, addr, eventType, token, cacheKey);
  }

  // Track whether this render is the first time this hook instance has seen
  // this particular cache key so we only increment refCount once per mount.
  const mountedKeyRef = useRef<string | null>(null);
  if (mountedKeyRef.current !== cacheKey) {
    entry.refCount += 1;
    mountedKeyRef.current = cacheKey;
  }

  useEffect(() => {
    const currentKey = cacheKey;
    cacheKeyRef.current = currentKey;

    // If the key changed between renders (serverUrl / address / eventKey
    // changed), the old entry was already released by the previous effect
    // cleanup. The new entry's refCount was incremented during render above.

    return () => {
      releaseEntry(currentKey);
      // Reset so a future remount with the same key increments refCount again.
      mountedKeyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // --- Suspense protocol ---
  // If the entry is still pending, throw the promise. React will catch it,
  // show the nearest Suspense fallback, and re-render when it resolves.
  if (entry.data.status === "pending") {
    throw entry.data.promise;
  }

  return entry.data.event as T;
}
