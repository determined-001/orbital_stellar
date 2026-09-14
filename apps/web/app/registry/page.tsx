import Link from "next/link";
import {
  getOnChainSpecs,
  getVerdictStore,
  stellarExpertAccountUrl,
  stellarExpertContractUrl,
} from "@/lib/registry";
import { getLabelRecords } from "@/lib/registryData";

// Revalidated on a short TTL rather than force-dynamic on every request:
// the underlying OnChainAbiRegistryClient already caches reads for 5
// minutes (registry.ts's DEFAULT_CACHE_TTL_MS), so re-rendering on every
// request would burn RPC-shaped work for a response that hadn't changed.
export const revalidate = 60;

function StatusBadge({ status }: { status: string | undefined }) {
  if (!status) {
    return (
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 700,
          padding: "2px 8px",
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          color: "var(--muted)",
        }}
      >
        UNVERIFIED
      </span>
    );
  }

  const colors: Record<string, { bg: string; border: string; text: string }> = {
    verified: { bg: "#0a2a0a", border: "#1a4a1a", text: "#4ade80" },
    mismatch: { bg: "#2a0a0a", border: "#4a1a1a", text: "#ff5370" },
    unverifiable: { bg: "#2a2a00", border: "#4a4a00", text: "#facc15" },
  };

  const c = colors[status] ?? { bg: "var(--surface2)", border: "var(--border)", text: "var(--muted)" };

  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 700,
        padding: "2px 8px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

const GRID_COLUMNS = "1fr 140px 140px 140px 100px 60px";

export default async function RegistryPage() {
  // Live from the on-chain registry contract. Nothing on this page is a
  // hardcoded row. Reads that failed are reported separately from reads that
  // returned nothing, because "I could not reach the chain" and "this is not
  // registered" are different facts and a registry explorer that conflates
  // them is misreporting the thing it exists to report.
  const { specs, failures, configured, staleAsOf } = await getOnChainSpecs();
  const verdicts = await getVerdictStore().getAll();
  const verdictMap = new Map(verdicts.map((v) => [v.contractId, v]));
  const labelMap = new Map(getLabelRecords().map((l) => [l.contractId, l]));
  const fetchedAt = staleAsOf ?? Date.now();

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
            marginBottom: "8px",
          }}
        >
          ABI Registry Explorer
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "15px",
            color: "var(--muted2)",
            lineHeight: 1.6,
            marginBottom: "8px",
            maxWidth: "640px",
          }}
        >
          Every registered Soroban spec with on-chain verification status.
          Mismatched specs are flagged and automatically reported.
        </p>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "32px",
          }}
        >
          Fetched {new Date(fetchedAt).toISOString()}
        </p>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            overflow: "hidden",
            overflowX: "auto",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS,
              gap: "0",
              minWidth: "760px",
              background: "var(--surface2)",
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--font-sans)",
              fontSize: "12px",
              fontWeight: 700,
              color: "var(--muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            <div style={{ padding: "12px 16px" }}>Contract</div>
            <div style={{ padding: "12px 8px" }}>Publisher</div>
            <div style={{ padding: "12px 8px" }}>Spec Hash</div>
            <div style={{ padding: "12px 8px" }}>Labels</div>
            <div style={{ padding: "12px 8px" }}>Status</div>
            <div style={{ padding: "12px 8px", textAlign: "center" }}>Age</div>
          </div>

          {specs.length === 0 && (
            <div
              style={{
                padding: "60px 16px",
                textAlign: "center",
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                color: "var(--muted)",
              }}
            >
              {!configured
                ? "No registry contract configured. Set ORBITAL_REGISTRY_TESTNET_CONTRACT_ID once the registry is deployed."
                : failures.length > 0
                  ? `Could not read the registry: ${failures[0]!.reason}`
                  : "The registry contract is reachable and holds no published specs yet."}
            </div>
          )}

          {staleAsOf ? (
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "#facc15",
              }}
            >
              Showing the last successful read from{" "}
              {Math.round((Date.now() - staleAsOf) / 1000)}s ago — the registry is currently
              unreachable ({failures[0]!.reason})
            </div>
          ) : null}
          {!staleAsOf && failures.length > 0 && specs.length > 0 ? (
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "#facc15",
              }}
            >
              {failures.length} of {specs.length + failures.length} could not be read —{" "}
              {failures[0]!.reason}
            </div>
          ) : null}
          {specs.map(({ contractId, spec, record }) => {
            const verdict = verdictMap.get(contractId);
            const verifiedAt = verdict?.verifiedAt
              ? `${Math.round((Date.now() - new Date(verdict.verifiedAt).getTime()) / 60000)}m ago`
              : "—";
            const label = labelMap.get(contractId);

            return (
              <div
                key={contractId}
                style={{
                  display: "grid",
                  gridTemplateColumns: GRID_COLUMNS,
                  gap: "0",
                  minWidth: "760px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <Link
                  href={`/registry/${contractId}`}
                  style={{
                    padding: "14px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    color: "#fff",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{spec.name}</span>
                  <span style={{ color: "var(--muted)", marginLeft: "8px", fontSize: "11px" }}>
                    {contractId.slice(0, 12)}…
                  </span>
                </Link>
                <div style={{ padding: "14px 8px", display: "flex", alignItems: "center" }}>
                  {record ? (
                    <a
                      href={stellarExpertAccountUrl(record.publisher)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        color: "var(--muted2)",
                        textDecoration: "underline",
                      }}
                    >
                      {record.publisher.slice(0, 8)}…
                    </a>
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: "11px" }}>—</span>
                  )}
                </div>
                <div style={{ padding: "14px 8px", display: "flex", alignItems: "center" }}>
                  {record ? (
                    <a
                      href={record.pointer}
                      target="_blank"
                      rel="noreferrer"
                      title={record.specHash}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        color: "var(--muted2)",
                        textDecoration: "underline",
                      }}
                    >
                      {record.specHash.slice(0, 10)}…
                    </a>
                  ) : (
                    <span style={{ color: "var(--muted)", fontSize: "11px" }}>—</span>
                  )}
                </div>
                <div
                  style={{
                    padding: "14px 8px",
                    display: "flex",
                    alignItems: "center",
                    fontFamily: "var(--font-sans)",
                    fontSize: "11px",
                    color: "var(--muted2)",
                  }}
                >
                  {label ? label.category : "—"}
                </div>
                <div style={{ padding: "12px 8px", display: "flex", alignItems: "center" }}>
                  <StatusBadge status={verdict?.status} />
                </div>
                <div
                  style={{
                    padding: "14px 8px",
                    textAlign: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  {verifiedAt}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
