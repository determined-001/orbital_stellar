import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

type ConnectionKey = {
  serverUrl: string;
  address: string;
  token?: string;
  withCredentials?: boolean;
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
  /** DevTools registry id, assigned only in development (see `withDevtools`). */
  devId?: string;
};

const pool = new Map<string, ConnectionEntry>();

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

export function acquireEventConnection(key: ConnectionKey, subscriber: ConnectionSubscriber) {
  const poolKey = getConnectionKey(key);
  let entry = pool.get(poolKey);

  if (!entry) {
    const newEntry: ConnectionEntry = {
      source: new EventSource(
        getEventSourceUrl(key),
        key.withCredentials ? { withCredentials: true } : undefined,
      ),
      subscribers: new Set(),
      connected: false,
    };

    newEntry.source.onopen = () => {
      newEntry.connected = true;
      notifySubscribers(newEntry, (current) => current.onOpen());
      withDevtools((mod) => {
        if (newEntry.devId) mod.updateConnection(newEntry.devId, { connected: true, error: null });
      });
    };

    newEntry.source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as NormalizedEvent;
        notifySubscribers(newEntry, (current) => current.onEvent(event));
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
    get connected() {
      return entry.connected;
    },
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

// --- Contract event connection helpers -------------------------------------------------
// Build a unique key for contract subscriptions based on contractId, topics, and token.
function getContractKey({
  serverUrl,
  contractId,
  topics,
  token,
  withCredentials,
}: {
  serverUrl: string;
  contractId: string;
  topics?: string[];
  token?: string;
  withCredentials?: boolean;
}): string {
  // Sort topics to ensure stable key irrespective of order.
  const sortedTopics = topics ? [...topics].sort().join(",") : "";
  // Include withCredentials flag for completeness.
  return JSON.stringify([
    serverUrl,
    contractId,
    sortedTopics,
    token ?? "",
    withCredentials ?? false,
  ]);
}

// Construct EventSource URL for contract events, mirroring address logic.
function getContractEventSourceUrl({
  serverUrl,
  contractId,
  topics,
  token,
}: {
  serverUrl: string;
  contractId: string;
  topics?: string[];
  token?: string;
}): string {
  const base = `${serverUrl}/contract_events/${contractId}`;
  const query: string[] = [];
  if (topics && topics.length > 0) query.push(`topics=${encodeURIComponent(topics.join(","))}`);
  if (token) query.push(`token=${encodeURIComponent(token)}`);
  return query.length > 0 ? `${base}?${query.join("&")}` : base;
}

/** Acquire a connection for a contract event subscription.
 *  Returns an object with `connected` flag and `unsubscribe` method similar to `acquireEventConnection`.
 */
export function acquireContractEventConnection(
  key: {
    serverUrl: string;
    contractId: string;
    topics?: string[];
    token?: string;
    withCredentials?: boolean;
  },
  subscriber: ConnectionSubscriber,
) {
  const poolKey = getContractKey(key);
  let entry = pool.get(poolKey);

  if (!entry) {
    const newEntry: ConnectionEntry = {
      source: new EventSource(
        getContractEventSourceUrl(key),
        key.withCredentials ? { withCredentials: true } : undefined,
      ),
      subscribers: new Set(),
      connected: false,
    };

    newEntry.source.onopen = () => {
      newEntry.connected = true;
      notifySubscribers(newEntry, (cur) => cur.onOpen());
      withDevtools((mod) => {
        if (newEntry.devId) mod.updateConnection(newEntry.devId, { connected: true, error: null });
      });
    };

    newEntry.source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as NormalizedEvent;
        notifySubscribers(newEntry, (cur) => cur.onEvent(event));
        withDevtools((mod) => {
          if (newEntry.devId) mod.updateConnection(newEntry.devId, { lastEvent: Date.now() });
        });
      } catch {
        notifySubscribers(newEntry, (cur) => cur.onParseError());
      }
    };

    newEntry.source.onerror = () => {
      newEntry.connected = false;
      notifySubscribers(newEntry, (cur) => cur.onError());
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
        address: key.contractId, // reuse address field for devtools display
        url: getContractEventSourceUrl(key),
        connected: newEntry.connected,
        error: null,
      });
    });

    pool.set(poolKey, newEntry);
    entry = newEntry;
  }

  entry.subscribers.add(subscriber);

  return {
    get connected() {
      return entry.connected;
    },
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
