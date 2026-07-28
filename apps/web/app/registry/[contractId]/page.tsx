import type { Metadata } from "next";
import { getContractDetail } from "@/lib/registry";

export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contractId: string }>;
}): Promise<Metadata> {
  const { contractId } = await params;
  return { title: `Registry - ${contractId}` };
}

function explorerUrl(contractId: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${contractId}`;
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  const result = await getContractDetail(contractId);

  if (!result.ok) {
    const heading =
      result.reason === "not_configured"
        ? "Registry not configured"
        : result.reason === "invalid_contract_id"
          ? "Invalid contract ID"
          : "Couldn't load contract";
    return (
      <section style={{ padding: "120px 32px" }}>
        <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
          <h1
            style={{ fontFamily: "var(--font-heading)", fontSize: "1.75rem", color: "#fff", marginBottom: "16px" }}
          >
            {heading}
          </h1>
          <p
            style={{
              padding: "16px",
              background: "#2a0000",
              border: "1px solid #440000",
              color: "#ff8080",
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
            }}
          >
            {result.message}
          </p>
        </div>
      </section>
    );
  }

  const { detail } = result;

  return (
    <section style={{ padding: "120px 32px" }}>
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(1.5rem, 3vw, 2rem)",
            color: "#fff",
            marginBottom: "8px",
            wordBreak: "break-all",
          }}
        >
          {detail.spec.name || detail.contractId}
        </h1>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--muted)", marginBottom: "24px" }}>
          <a href={explorerUrl(detail.contractId)} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
            {detail.contractId}
          </a>{" "}
          &middot; published by {detail.publisher}
        </p>

        <div style={{ display: "grid", gap: "24px", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "16px" }}>
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "#fff", marginBottom: "12px" }}>
              Version history
            </h2>
            {detail.versions.length === 0 ? (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--muted)" }}>
                No versions found.
              </p>
            ) : (
              <table style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted2)" }}>
                <tbody>
                  {[...detail.versions].reverse().map((v) => (
                    <tr key={v.version} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 0", color: "#fff" }}>v{v.version}</td>
                      <td style={{ padding: "6px 0" }}>ledger {v.publishedAtLedger}</td>
                      <td style={{ padding: "6px 0" }}>
                        <a href={v.pointer} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>
                          spec
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", padding: "16px" }}>
            <h2 style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "#fff", marginBottom: "12px" }}>
              Events
            </h2>
            {detail.spec.events.length === 0 ? (
              <p style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--muted)" }}>
                This spec declares no events.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                {detail.spec.events.map((ev) => (
                  <li
                    key={ev.name}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--muted2)",
                    }}
                  >
                    <span style={{ color: "#fff" }}>{ev.name}</span>
                    <span style={{ color: "var(--accent)" }}>
                      {detail.semantics[ev.name] ?? "unmapped"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p style={{ fontFamily: "var(--font-sans)", fontSize: "11px", color: "var(--muted)", marginTop: "12px" }}>
              Semantic labels come from Orbital's bundled taxonomy - "unmapped" means genuinely
              unclassified, not an error.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
