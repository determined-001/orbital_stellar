import React, { useEffect, useState } from "react";

export type DevConnection = {
  id: string;
  serverUrl: string;
  address: string;
  url: string;
  connected: boolean;
  error: string | null;
  lastEvent: number | null;
};

const connections = new Map<string, DevConnection>();
const events = new EventTarget();

function emit() {
  events.dispatchEvent(new CustomEvent("pulse-notify:change"));
}

export function registerConnection(
  info: Omit<DevConnection, "id" | "lastEvent"> & { id?: string },
) {
  const id =
    info.id ?? `${info.serverUrl}::${info.address}::${Math.random().toString(36).slice(2, 9)}`;
  const conn: DevConnection = {
    id,
    serverUrl: info.serverUrl,
    address: info.address,
    url: info.url,
    connected: Boolean(info.connected),
    error: info.error ?? null,
    lastEvent: null,
  };
  connections.set(id, conn);
  emit();
  return id;
}

export function updateConnection(
  id: string,
  patch: Partial<
    Omit<DevConnection, "id" | "serverUrl" | "address" | "url"> & { lastEvent?: number }
  >,
) {
  const cur = connections.get(id);
  if (!cur) return;
  const next: DevConnection = { ...cur, ...patch } as DevConnection;
  connections.set(id, next);
  emit();
}

export function unregisterConnection(id: string) {
  if (connections.delete(id)) emit();
}

export function listConnections(): DevConnection[] {
  return Array.from(connections.values()).sort((a, b) => a.address.localeCompare(b.address));
}

export function subscribe(fn: () => void) {
  const handler = () => fn();
  events.addEventListener("pulse-notify:change", handler as EventListener);
  return () => events.removeEventListener("pulse-notify:change", handler as EventListener);
}

export function PulseNotifyDevtools(): React.ReactElement | null {
  const [state, setState] = useState<DevConnection[]>(() => listConnections());

  useEffect(() => {
    const unsub = subscribe(() => setState(listConnections()));
    return unsub;
  }, []);

  // Only render in development and in the browser. The hooks above run
  // unconditionally so hook order stays stable across renders.
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;

  return (
    <div style={{ padding: 12, fontFamily: "Inter, system-ui, sans-serif", fontSize: 12 }}>
      <h3 style={{ margin: "0 0 8px 0" }}>Pulse Notify — Active Connections</h3>
      <div
        style={{
          maxHeight: 360,
          overflow: "auto",
          border: "1px solid #eee",
          padding: 8,
          borderRadius: 6,
        }}
      >
        {state.length === 0 && <div style={{ color: "#666" }}>No active connections</div>}
        {state.map((c) => (
          <div key={c.id} style={{ padding: 8, borderBottom: "1px dashed #f0f0f0" }}>
            <div>
              <strong>Address:</strong> {c.address}
            </div>
            <div>
              <strong>URL:</strong> {c.url}
            </div>
            <div>
              <strong>Connected:</strong> {c.connected ? "yes" : "no"}{" "}
              {c.error ? ` — ${c.error}` : ""}
            </div>
            <div>
              <strong>Last event:</strong>{" "}
              {c.lastEvent ? new Date(c.lastEvent).toLocaleString() : "—"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PulseNotifyDevtools;
