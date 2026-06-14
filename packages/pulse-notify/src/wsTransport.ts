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

type WsEntry = {
  ws: WebSocket;
  subscribers: Set<ConnectionSubscriber>;
  connected: boolean;
};

const pool = new Map<string, WsEntry>();

function getKey({ serverUrl, address, token }: ConnectionKey): string {
  return JSON.stringify([serverUrl, address, token ?? ""]);
}

function getWsUrl({ serverUrl, address, token }: ConnectionKey): string {
  const base = serverUrl.replace(/^http/, "ws") + `/events/${address}`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

function notify(entry: WsEntry, fn: (s: ConnectionSubscriber) => void) {
  for (const s of [...entry.subscribers]) fn(s);
}

export function acquireWsConnection(key: ConnectionKey, subscriber: ConnectionSubscriber) {
  const poolKey = getKey(key);
  let entry = pool.get(poolKey);

  if (!entry) {
    const ws = new WebSocket(getWsUrl(key));
    const newEntry: WsEntry = { ws, subscribers: new Set(), connected: false };

    ws.onopen = () => {
      newEntry.connected = true;
      notify(newEntry, (s) => s.onOpen());
    };

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string) as NormalizedEvent;
        notify(newEntry, (s) => s.onEvent(event));
      } catch {
        notify(newEntry, (s) => s.onParseError());
      }
    };

    ws.onerror = () => {
      newEntry.connected = false;
      notify(newEntry, (s) => s.onError());
    };

    ws.onclose = () => {
      newEntry.connected = false;
      notify(newEntry, (s) => s.onError());
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
        entry.ws.close();
        pool.delete(poolKey);
      }
    },
  };
}

export function __getWsPoolSizeForTests() {
  return pool.size;
}

export function __resetWsPoolForTests() {
  for (const entry of pool.values()) entry.ws.close();
  pool.clear();
}
