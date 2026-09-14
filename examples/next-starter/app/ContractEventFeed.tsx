"use client";

import { useEffect, useState } from "react";

/**
 * Demonstrates the generated types from orbital.config.ts (issue #908):
 * `/api/contract-events` classifies each event with the real generated
 * guards (`isPingEvent`, `isTransferEvent`, ...) server-side; this just
 * renders whatever description it sends. A plain `EventSource` here rather
 * than `useStellarEvent` - that hook is built around the per-address
 * `/api/events/<address>` route shape, not this fixed two-contract stream.
 */
export default function ContractEventFeed() {
  const [seen, setSeen] = useState<Array<{ key: string; line: string }>>([]);

  useEffect(() => {
    const source = new EventSource("/api/contract-events");
    source.onmessage = (message) => {
      const { description, at } = JSON.parse(message.data) as { description: string; at: string };
      setSeen((previous) =>
        [{ key: `${at}-${previous.length}`, line: `${description} · ${at}` }, ...previous].slice(
          0,
          25,
        ),
      );
    };
    return () => source.close();
  }, []);

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ fontSize: 15, marginBottom: 8 }}>Demo-emitter / USDC events</h2>
      {seen.length === 0 ? (
        <p style={{ fontSize: 14, opacity: 0.6 }}>
          Nothing yet. This watches the deployed testnet demo-emitter and mainnet USDC (the two
          contracts <code>orbital.config.ts</code> generates types for) - fire the demo-emitter's{" "}
          <code>ping()</code> to see one arrive.
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
