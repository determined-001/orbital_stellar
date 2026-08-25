import EventFeed from "./EventFeed";
import { loadConfig, StarterConfigError } from "@/lib/config";

/**
 * Server component. Config is validated here rather than in the browser, so a
 * missing `STELLAR_ADDRESSES` surfaces as a readable page instead of an empty
 * stream that never explains itself.
 */
export default function Home() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof StarterConfigError) {
      return (
        <>
          <h1 style={{ fontSize: 22 }}>Orbital Next.js starter</h1>
          <p style={{ color: "#f87171" }}>{err.message}</p>
          <p style={{ fontSize: 14, opacity: 0.7 }}>
            Copy <code>.env.example</code> to <code>.env.local</code> and set the values it
            lists, then restart the dev server.
          </p>
        </>
      );
    }
    throw err;
  }

  return (
    <>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Orbital Next.js starter</h1>
      <p style={{ fontSize: 14, opacity: 0.7, marginTop: 0 }}>
        Live Stellar events on <strong>{config.network}</strong>, streamed from the server
        engine over SSE.
      </p>
      <EventFeed addresses={config.addresses} />
    </>
  );
}
