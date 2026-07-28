import type { Metadata } from "next";
import Link from "next/link";
import { listRegisteredContracts } from "@/lib/registry";

export const metadata: Metadata = {
  title: "Registry",
  description: "Contracts published to Orbital's on-chain ABI registry",
};

export const revalidate = 30;

function shorten(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
}

export default async function RegistryPage() {
  const result = await listRegisteredContracts();

  return (
    <section style={{ padding: "120px 32px" }}>
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
            color: "#fff",
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            marginBottom: "16px",
          }}
        >
          ABI Registry
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "15px",
            color: "var(--muted2)",
            lineHeight: 1.6,
            marginBottom: "32px",
            maxWidth: "640px",
          }}
        >
          Contracts that have published a spec to Orbital's on-chain ABI registry, read directly
          from the registry contract's own event history - no mock data.
        </p>

        {!result.ok && (
          <div
            style={{
              padding: "16px",
              background: "#2a0000",
              border: "1px solid #440000",
              color: "#ff8080",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              marginBottom: "24px",
            }}
          >
            {result.reason === "not_configured"
              ? "⚠️ The registry contract hasn't been deployed/seeded yet."
              : "⚠️ Couldn't reach the registry."}{" "}
            {result.message}
          </div>
        )}

        {result.ok && (
          <>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--muted)",
                marginBottom: "16px",
              }}
            >
              Fetched {result.fetchedAt} - {result.contracts.length} contract
              {result.contracts.length === 1 ? "" : "s"} observed. Only publications within the
              scanned event-history window appear here; this is not guaranteed to be a complete
              historical listing.
            </p>

            {result.contracts.length === 0 ? (
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "14px",
                  color: "var(--muted)",
                  marginTop: "40px",
                }}
              >
                No published contracts observed in the scanned window.
              </p>
            ) : (
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                {result.contracts.map((c) => (
                  <Link
                    key={c.contractId}
                    href={`/registry/${c.contractId}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "12px",
                      padding: "14px 16px",
                      borderBottom: "1px solid var(--border)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                      color: "#fff",
                      textDecoration: "none",
                    }}
                  >
                    <span>{c.contractId}</span>
                    <span style={{ color: "var(--accent)" }}>v{c.latestVersion}</span>
                    <span style={{ color: "var(--muted)" }}>{shorten(c.specHash)}</span>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}

        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--muted)",
            marginTop: "32px",
          }}
        >
          Entity labels (human-readable names for publishers/contracts) aren't implemented yet -
          contract IDs are shown as raw strkeys.
        </p>
      </div>
    </section>
  );
}
