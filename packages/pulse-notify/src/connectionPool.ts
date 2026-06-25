import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

type ConnectionKey = {
  serverUrl: string;
  address: string;
  token?: string;
};

type ConnectionSubscriber = {
  onOpen: () => void;
  onEvent: (event: NormalizedEvent) => void;
  onParseError: () => void;
  onError: () => void;
};

type ConnectionEntry = {
  source: EventSource;
  subscribers: Set<ConnectionSubscriber>;
  connected: boolean;
  serverUrl: string;
  address: string;
  lastEventAt: number | null;
  /** DevTools registry id, assigned only in development (see `withDevtools`). */
  devId?: string;
};

const pool = new Map<string, ConnectionEntry>();
const devtoolsObservers = new Set<() => void>();

function getConnectionKey({ serverUrl, address, token }: ConnectionKey): string {
  return JSON.stringify([serverUrl, address, token ?? ""]);
// --- DevTools instrumentation (issue #417) -------------------------------
// The pool is the single chokepoint where EventSource connections are created,
// opened, errored, and closed, so it is the natural place to feed the DevTools
// "active connections" panel. The DevTools module is imported lazily so it is
// code-split out of production bundles; this helper is a no-op in production and
// during SSR.
type DevtoolsModule = typeof import("./devtools.js");
let devtools: DevtoolsModule | null = null;
let devtoolsLoad: Promise<void> | null | undefined;

function withDevtools(run: (mod: DevtoolsModule) => void): void {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return;
  if (devtools) {
    run(devtools);
    return;
  }
  if (devtoolsLoad === undefined) {
    devtoolsLoad = import("./devtools.js")
      .then((mod) => {
        devtools = mod;
      })
      .catch(() => {
        devtoolsLoad = null;
      });
  }
  void devtoolsLoad?.then(() => {
    if (devtools) run(devtools);
  });
}

function getConnectionKey({ serverUrl, address, token, withCredentials }: ConnectionKey): string {
  return JSON.stringify([serverUrl, address, token ?? "", withCredentials ?? false]);
}

function getEventSourceUrl({ serverUrl, address, token }: ConnectionKey): string {
  const base = `${serverUrl}/events/${address}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function notifySubscribers(
  entry: ConnectionEntry,
  notify: (subscriber: ConnectionSubscriber) => void,
) {
  for (const subscriber of [...entry.subscribers]) {
    notify(subscriber);
  }
}

function notifyDevtools() {
  for (const observer of devtoolsObservers) {
    observer();
  }
}

export function acquireEventConnection(
  key: ConnectionKey,
  subscriber: ConnectionSubscriber
) {
export function acquireEventConnection(key: ConnectionKey, subscriber: ConnectionSubscriber) {
  const poolKey = getConnectionKey(key);
  let entry = pool.get(poolKey);

  if (!entry) {
    const newEntry: ConnectionEntry = {
      source: new EventSource(getEventSourceUrl(key)),
      source: new EventSource(
        getEventSourceUrl(key),
        key.withCredentials ? { withCredentials: true } : undefined,
      ),
      subscribers: new Set(),
      connected: false,
      serverUrl: key.serverUrl,
      address: key.address,
      lastEventAt: null,
    };

    newEntry.source.onopen = () => {
      newEntry.connected = true;
      notifySubscribers(newEntry, (current) => current.onOpen());
      notifyDevtools();
      withDevtools((mod) => {
        if (newEntry.devId) mod.updateConnection(newEntry.devId, { connected: true, error: null });
      });
    };

    newEntry.source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as NormalizedEvent;
        newEntry.lastEventAt = Date.now();
        notifySubscribers(newEntry, (current) => current.onEvent(event));
        notifyDevtools();
        withDevtools((mod) => {
          if (newEntry.devId) mod.updateConnection(newEntry.devId, { lastEvent: Date.now() });
        });
      } catch {
        notifySubscribers(newEntry, (current) => current.onParseError());
      }
    };

    newEntry.source.onerror = () => {
      newEntry.connected = false;
      notifySubscribers(newEntry, (current) => current.onError());
      notifyDevtools();
      withDevtools((mod) => {
        if (newEntry.devId) {
          mod.updateConnection(newEntry.devId, {
            connected: false,
            error: "Connection lost — retrying...",
          });
        }
      });
    };

    withDevtools((mod) => {
      newEntry.devId = mod.registerConnection({
        serverUrl: key.serverUrl,
        address: key.address,
        url: getEventSourceUrl(key),
        connected: newEntry.connected,
        error: null,
      });
    });

    pool.set(poolKey, newEntry);
    entry = newEntry;
  }

  entry.subscribers.add(subscriber);

  return {
    connected: entry.connected,
    unsubscribe: () => {
      entry.subscribers.delete(subscriber);

      if (entry.subscribers.size === 0) {
        entry.source.close();
        pool.delete(poolKey);
        withDevtools((mod) => {
          if (entry.devId) mod.unregisterConnection(entry.devId);
        });
      }
    },
  };
}

export function __getConnectionPoolSizeForTests() {
  return pool.size;
}

export function __resetConnectionPoolForTests() {
  for (const entry of pool.values()) {
    entry.source.close();
  }
  pool.clear();
}

/**
 * DevTools API: Get a snapshot of all active connections.
 * @internal
 */
export function __devtoolsGetConnections() {
  return Array.from(pool.entries()).map(([key, entry]) => ({
    key,
    serverUrl: entry.serverUrl,
    address: entry.address,
    connected: entry.connected,
    subscriberCount: entry.subscribers.size,
    lastEventAt: entry.lastEventAt,
  }));
}

/**
 * DevTools API: Subscribe to pool changes for real-time updates.
 * Returns an unsubscribe function.
 * @internal
 */
export function __devtoolsSubscribe(callback: () => void): () => void {
  devtoolsObservers.add(callback);
  return () => {
    devtoolsObservers.delete(callback);
  };
}
