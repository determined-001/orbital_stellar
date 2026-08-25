"use client";

import { useState } from "react";
import { useStellarEvent } from "@orbital-stellar/pulse-notify";

/**
 * The whole point of the starter, in one component: pick an address, and
 * `useStellarEvent` keeps a live SSE connection to `/api/events/<address>`
 * open and hands back the latest normalized event.
 *
 * `serverUrl` is `/api` because the hook builds `${serverUrl}/events/${address}`
 * (see `connectionPool.ts`), which is exactly the route in `app/api/events`.
 */
export default function EventFeed({ addresses }: { addresses: string[] }) {
  const [address, setAddress] = useState(addresses[0]!);
  const [seen, setSeen] = useState<Array<{ key: string; line: string }>>([]);

  const { connected, error, lastEventAt } = useStellarEvent({
    serverUrl: "/api",
    address,
    onEvent: (event) => {
      setSeen((previous) =>
        [
          {
            key: `${event.type}-${event.timestamp}-${previous.length}`,
            line: `${event.type} · ${event.timestamp}`,
          },
          ...previous,
        ].slice(0, 25),
      );
    },
  });

  return (
    <section>
      <label style={{ display: "block", marginBottom: 8, fontSize: 14, opacity: 0.7 }}>
        Watching
      </label>
      <select
        value={address}
        onChange={(e) => {
          setAddress(e.target.value);
          setSeen([]);
        }}
        style={{
          width: "100%",
          padding: "10px 12px",
          background: "#151517",
          color: "inherit",
          border: "1px solid #2a2a2e",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
        }}
      >
        {addresses.map((candidate) => (
          <option key={candidate} value={candidate}>
            {candidate}
          </option>
        ))}
      </select>

      <p style={{ fontSize: 14, marginTop: 16 }}>
        <span style={{ color: connected ? "#4ade80" : "#facc15" }}>●</span>{" "}
        {connected ? "connected" : "connecting…"}
        {lastEventAt ? ` · last event ${lastEventAt}` : ""}
      </p>

      {error ? <p style={{ color: "#f87171", fontSize: 14 }}>{error}</p> : null}

      <h2 style={{ fontSize: 15, marginTop: 32, marginBottom: 8 }}>Events</h2>
      {seen.length === 0 ? (
        <p style={{ fontSize: 14, opacity: 0.6 }}>
          Nothing yet. Events appear here the moment this account transacts — send it a
          payment from another wallet, or use Friendbot on testnet, to see one arrive.
        </p>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
          }}
        >
          {seen.map(({ key, line }) => (
            <li key={key} style={{ padding: "8px 0", borderBottom: "1px solid #1e1e21" }}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
