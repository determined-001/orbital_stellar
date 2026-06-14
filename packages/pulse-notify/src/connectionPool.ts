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
};

const pool = new Map<string, ConnectionEntry>();

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
    };

    newEntry.source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as NormalizedEvent;
        notifySubscribers(newEntry, (current) => current.onEvent(event));
      } catch {
        notifySubscribers(newEntry, (current) => current.onParseError());
      }
    };

    newEntry.source.onerror = () => {
      newEntry.connected = false;
      notifySubscribers(newEntry, (current) => current.onError());
    };

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
