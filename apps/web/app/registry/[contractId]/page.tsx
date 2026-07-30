import { getSpecStore, getVerdictStore } from "@/lib/registry";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
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
        fontSize: "13px",
        fontWeight: 700,
        padding: "4px 12px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
      }}
    >
      {status.toUpperCase()}
    </span>
  );
}

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  const spec = await getSpecStore().get(contractId);
  const history = await getVerdictStore().getHistory(contractId);
  const latestVerdict = history[history.length - 1] ?? null;

  if (!spec) {
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
            Contract Not Found
          </h1>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "15px", color: "var(--muted2)" }}>
            No spec registered for <code>{contractId}</code>.
          </p>
        </div>
      </section>
    );
  }

  const isMismatch = latestVerdict?.status === "mismatch";
  const isUnverifiable = latestVerdict?.status === "unverifiable";

  return (
    <section style={{ padding: "120px 32px" }}>
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        {isMismatch && (
          <div
            style={{
              padding: "12px 16px",
              marginBottom: "24px",
              background: "#2a0a0a",
              border: "1px solid #4a1a1a",
              color: "#ff5370",
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              lineHeight: 1.5,
            }}
          >
            <strong style={{ fontSize: "15px" }}>⚠ SCHEMA MISMATCH</strong>
            <br />
            The submitted schema does not match the on-chain contract spec.
            {latestVerdict?.diffs && latestVerdict.diffs.length > 0 && (
              <span> Found {latestVerdict.diffs.length} difference(s).</span>
            )}
          </div>
        )}

        {isUnverifiable && (
          <div
            style={{
              padding: "12px 16px",
              marginBottom: "24px",
              background: "#2a2a00",
              border: "1px solid #4a4a00",
              color: "#facc15",
              fontFamily: "var(--font-sans)",
              fontSize: "14px",
              lineHeight: 1.5,
            }}
          >
            <strong>ⓘ UNVERIFIABLE</strong>
            <br />
            {latestVerdict?.reason ?? "This contract has no embedded spec (pre-SEP-48 or non-WASM)."}
            <br />
            Displayed as attested-only — not verified.
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
              color: "#fff",
              lineHeight: 1.1,
              letterSpacing: "-0.01em",
              margin: 0,
            }}
          >
            {spec.spec.name}
          </h1>
          {latestVerdict && <StatusBadge status={latestVerdict.status} />}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "24px",
            marginBottom: "32px",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              padding: "16px",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "12px",
              }}
            >
              Contract Info
            </h3>
            <dl style={{ fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: 1.8 }}>
              <dt style={{ color: "var(--muted)", fontSize: "11px" }}>Contract ID</dt>
              <dd style={{ color: "#fff", margin: 0, wordBreak: "break-all" }}>{contractId}</dd>
              <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Version</dt>
              <dd style={{ color: "#fff", margin: 0 }}>{spec.spec.version}</dd>
              <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Network</dt>
              <dd style={{ color: "#fff", margin: 0 }}>{spec.spec.network ?? "unknown"}</dd>
            </dl>
          </div>

          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              padding: "16px",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: "12px",
              }}
            >
              Verification
            </h3>
            <dl style={{ fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: 1.8 }}>
              <dt style={{ color: "var(--muted)", fontSize: "11px" }}>Status</dt>
              <dd style={{ color: "#fff", margin: 0 }}>
                {latestVerdict?.status ?? "never verified"}
              </dd>
              {latestVerdict?.verifiedAt && (
                <>
                  <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>
                    Last Verified
                  </dt>
                  <dd style={{ color: "#fff", margin: 0 }}>
                    {new Date(latestVerdict.verifiedAt).toLocaleString()}
                  </dd>
                </>
              )}
              {latestVerdict?.previousStatus && (
                <>
                  <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>
                    Previous Status
                  </dt>
                  <dd style={{ color: "#fff", margin: 0 }}>
                    <StatusBadge status={latestVerdict.previousStatus} />
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>

        {latestVerdict?.diffs && latestVerdict.diffs.length > 0 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              marginBottom: "32px",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Differences ({latestVerdict.diffs.length})
            </div>
            <div style={{ padding: "16px" }}>
              {latestVerdict.diffs.map((diff, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: "16px",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: "16px",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      color: "#ff5370",
                      marginBottom: "8px",
                    }}
                  >
                    {diff.path}
                  </p>
                  <div style={{ display: "flex", gap: "16px", fontSize: "12px" }}>
                    <div style={{ flex: 1 }}>
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "11px",
                          color: "var(--muted)",
                          marginBottom: "4px",
                        }}
                      >
                        Submitted
                      </p>
                      <pre
                        style={{
                          fontFamily: "var(--font-mono)",
                          background: "var(--surface2)",
                          padding: "8px",
                          border: "1px solid var(--border)",
                          color: "#facc15",
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {JSON.stringify(diff.submitted, null, 2) ?? "null"}
                      </pre>
                    </div>
                    <div style={{ flex: 1 }}>
                      <p
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "11px",
                          color: "var(--muted)",
                          marginBottom: "4px",
                        }}
                      >
                        On-Chain
                      </p>
                      <pre
                        style={{
                          fontFamily: "var(--font-mono)",
                          background: "var(--surface2)",
                          padding: "8px",
                          border: "1px solid var(--border)",
                          color: "#4ade80",
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                        }}
                      >
                        {JSON.stringify(diff.onChain, null, 2) ?? "null"}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {history.length > 1 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Verification History
            </div>
            <div style={{ padding: "16px" }}>
              {[...history].reverse().map((record, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "8px 0",
                    borderBottom: i < history.length - 1 ? "1px solid var(--border)" : "none",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                  }}
                >
                  <StatusBadge status={record.status} />
                  <span style={{ color: "var(--muted)" }}>
                    {new Date(record.verifiedAt).toLocaleString()}
                  </span>
                  {record.previousStatus && (
                    <span style={{ color: "var(--muted2)" }}>
                      (was <StatusBadge status={record.previousStatus} />)
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {spec.spec.functions.length > 0 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              marginTop: "32px",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Functions ({spec.spec.functions.length})
            </div>
            <div style={{ padding: "16px" }}>
              {spec.spec.functions.map((fn, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: "12px",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: "12px",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                      color: "#fff",
                      fontWeight: 700,
                      marginBottom: "4px",
                    }}
                  >
                    {fn.name}
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)" }}>
                    Params: {fn.params.map((p) => `${p.name}: ${JSON.stringify(p.type)}`).join(", ") || "none"}
                    <br />
                    Returns: {JSON.stringify(fn.returns)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {spec.spec.events.length > 0 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              marginTop: "32px",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Events ({spec.spec.events.length})
            </div>
            <div style={{ padding: "16px" }}>
              {spec.spec.events.map((ev, i) => (
                <div
                  key={i}
                  style={{
                    marginBottom: "12px",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: "12px",
                  }}
                >
                  <p
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                      color: "#fff",
                      fontWeight: 700,
                      marginBottom: "4px",
                    }}
                  >
                    {ev.name}
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)" }}>
                    Topics: {ev.topics.map((t) => `${t.name}: ${JSON.stringify(t.type)}`).join(", ") || "none"}
                    <br />
                    Data: {ev.data.map((d) => `${d.name}: ${JSON.stringify(d.type)}`).join(", ") || "none"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
