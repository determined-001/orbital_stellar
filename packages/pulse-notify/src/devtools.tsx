import { useEffect, useMemo, useState } from "react";
import {
  __getConnectionPoolSnapshot,
  type ConnectionPoolDebugEntry,
} from "./connectionPool.js";
import {
  __getSuspenseConnectionSnapshot,
  type SuspenseConnectionDebugEntry,
} from "./useStellarEventSuspense.js";

function formatTimestamp(timestamp: string | null): string {
  return timestamp ?? "—";
}

function formatToken(token: string | undefined): string {
  return token ? "yes" : "no";
}

function connectionUrlDisplay(url: string): string {
  return url.replace(/([?&])token=[^&]+/, "$1token=***");
}

function useDevToolsSnapshot() {
  const [snapshot, setSnapshot] = useState(() => ({
    connections: __getConnectionPoolSnapshot(),
    suspenseConnections: __getSuspenseConnectionSnapshot(),
  }));

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSnapshot({
        connections: __getConnectionPoolSnapshot(),
        suspenseConnections: __getSuspenseConnectionSnapshot(),
      });
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  return snapshot;
}

export function DevToolsPanel() {
  const { connections, suspenseConnections } = useDevToolsSnapshot();

  const summary = useMemo(
    () => ({
      eventHooks: connections.length,
      suspenseHooks: suspenseConnections.length,
      total: connections.length + suspenseConnections.length,
    }),
    [connections.length, suspenseConnections.length]
  );

  return (
    <section
      style={{
        fontFamily: "system-ui, sans-serif",
        fontSize: "0.9rem",
        lineHeight: 1.5,
        color: "var(--devtools-foreground, #111)",
        background: "var(--devtools-background, #f8fafc)",
        border: "1px solid var(--devtools-border, #d1d5db)",
        borderRadius: 12,
        padding: 16,
        margin: 16,
      }}
    >
      <h2 style={{ margin: "0 0 12px", fontSize: "1rem" }}>Pulse Notify DevTools</h2>
      <p style={{ margin: "0 0 16px", color: "#475569" }}>
        Active hooks: {summary.total} ({summary.eventHooks} event hooks, {summary.suspenseHooks} suspense hooks)
      </p>

      <div style={{ display: "grid", gap: 20 }}>
        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>useStellarEvent connections</h3>
          {connections.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b" }}>No active event-hook connections.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Address</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Connected</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Last event</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Subscribers</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>URL</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Token</th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((entry) => (
                    <tr key={`${entry.serverUrl}:${entry.address}:${String(entry.token)}`}>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>{entry.address}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                        {entry.connected ? "yes" : "no"}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                        {formatTimestamp(entry.lastEventAt)}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                        {entry.subscriberCount}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }} title={entry.url}>
                        {connectionUrlDisplay(entry.url)}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                        {formatToken(entry.token)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>useStellarEventSuspense connections</h3>
          {suspenseConnections.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b" }}>No active suspense connections.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Address</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>State</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Last event</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Refs</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>Event key</th>
                    <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0" }}>URL</th>
                  </tr>
                </thead>
                <tbody>
                  {suspenseConnections.map((entry) => (
                    <tr key={`${entry.serverUrl}:${entry.address}:${entry.eventKey}:${String(entry.token)}`}>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>{entry.address}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>{entry.status}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>
                        {formatTimestamp(entry.lastEventAt)}
                      </td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>{entry.refCount}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }}>{entry.eventKey}</td>
                      <td style={{ padding: "8px", borderBottom: "1px solid #e2e8f0" }} title={entry.url}>
                        {connectionUrlDisplay(entry.url)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
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
