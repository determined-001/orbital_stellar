import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { DEMO_LIMITS } from "@/lib/demo-limits";

export const metadata: Metadata = {
  title: "Orbital Cloud",
  description:
    "Hosted Orbital is not available yet. The demo limits you hit are sandbox caps - self-hosting the MIT packages has none of them.",
};

/**
 * Landing page for `DEMO_LIMITS.upgradeUrl`.
 *
 * Every rate-limit response from the demo endpoints carries this URL, and three
 * components render it as a live link, so it has to resolve. It deliberately
 * does not present Cloud as purchasable: nothing is running yet, and a signup
 * form that collects nothing would be a worse answer than a 404.
 */
export default function CloudPage() {
  const streamSeconds = DEMO_LIMITS.streamDurationMs / 1000;
  const webhookSeconds = DEMO_LIMITS.webhookCooldownMs / 1000;

  return (
    <>
      <Nav />
      <section style={{ padding: "120px 32px" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto" }}>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginBottom: "16px",
            }}
          >
            Not available yet
          </p>

          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "48px",
              lineHeight: 1.1,
              color: "var(--text)",
              marginBottom: "20px",
            }}
          >
            Orbital Cloud
          </h1>

          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "18px",
              lineHeight: 1.6,
              color: "var(--muted2)",
              marginBottom: "40px",
            }}
          >
            You most likely arrived here from a demo limit. Hosted Orbital is not running yet —
            there is nothing to sign up for, and we would rather say so than collect an email
            against a product that does not exist.
          </p>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "24px",
              marginBottom: "32px",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--text)",
                marginBottom: "12px",
              }}
            >
              The limits you hit are demo caps, not product limits
            </h2>
            <ul
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                lineHeight: 1.8,
                color: "var(--muted2)",
                paddingLeft: "18px",
                margin: 0,
              }}
            >
              <li>
                {DEMO_LIMITS.perIpStreams} concurrent event stream per IP, capped at {streamSeconds}{" "}
                seconds
              </li>
              <li>one webhook signature every {webhookSeconds} seconds</li>
              <li>rate-limited test-event firing against a shared testnet account</li>
            </ul>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                lineHeight: 1.7,
                color: "var(--muted2)",
                marginTop: "16px",
                marginBottom: 0,
              }}
            >
              They exist so this public sandbox cannot be used to drain a funded account or run up
              hosting costs. They are not in the library.
            </p>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              padding: "24px",
              marginBottom: "32px",
            }}
          >
            <h2
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--text)",
                marginBottom: "12px",
              }}
            >
              Run it yourself today
            </h2>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                lineHeight: 1.7,
                color: "var(--muted2)",
                marginBottom: "16px",
              }}
            >
              Every package is MIT-licensed and on npm. Self-hosted, there is no stream cap, no
              cooldown, and no session timeout — you are talking to Horizon and Soroban RPC
              directly.
            </p>
            <pre
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "13px",
                color: "var(--text)",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                padding: "14px 16px",
                overflowX: "auto",
                margin: 0,
              }}
            >
              npm install @orbital-stellar/pulse-core
            </pre>
          </div>

          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <Link
              href="/docs/getting-started/quick-start"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                fontWeight: 700,
                color: "#000",
                background: "var(--accent)",
                padding: "10px 20px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Quick start
            </Link>
            <Link
              href="/starters"
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--text)",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                padding: "10px 20px",
                borderRadius: "6px",
                textDecoration: "none",
              }}
            >
              Starter templates
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}
