import Link from "next/link";
import { getSpecStore, getVerdictStore } from "@/lib/registry";

export const dynamic = "force-dynamic";

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

export default async function RegistryPage() {
  const specs = await getSpecStore().getAll();
  const verdicts = await getVerdictStore().getAll();
  const verdictMap = new Map(verdicts.map((v) => [v.contractId, v]));

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
            marginBottom: "32px",
            maxWidth: "640px",
          }}
        >
          Every registered Soroban spec with on-chain verification status.
          Mismatched specs are flagged and automatically reported.
        </p>

        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 60px",
              gap: "0",
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
              No registered specs yet.
            </div>
          )}

          {specs.map((spec) => {
            const verdict = verdictMap.get(spec.contractId);
            const verifiedAt = verdict?.verifiedAt
              ? `${Math.round((Date.now() - new Date(verdict.verifiedAt).getTime()) / 60000)}m ago`
              : "—";

            return (
              <Link
                key={spec.contractId}
                href={`/registry/${spec.contractId}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 60px",
                  gap: "0",
                  borderBottom: "1px solid var(--border)",
                  textDecoration: "none",
                  transition: "background 0.15s",
                }}
              >
                <div
                  style={{
                    padding: "14px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    color: "#fff",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>{spec.spec.name}</span>
                  <span style={{ color: "var(--muted)", marginLeft: "8px", fontSize: "11px" }}>
                    {spec.contractId.slice(0, 12)}…
                  </span>
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
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
