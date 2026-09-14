import {
  getOnChainContractDetail,
  getVerdictStore,
  stellarExpertAccountUrl,
  stellarExpertContractUrl,
} from "@/lib/registry";
import { getLabelRecords } from "@/lib/registryData";
import { getRecentContractEvents } from "@/lib/registryEvents";

// Same short-TTL rationale as the list page: the on-chain client already
// caches reads, so force-dynamic would re-pay for work whose answer hasn't
// changed.
export const revalidate = 60;

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
  const detail = await getOnChainContractDetail(contractId);
  const history = await getVerdictStore().getHistory(contractId);
  const latestVerdict = history[history.length - 1] ?? null;

  if (!detail.found) {
    // "Not registered" and "could not read the chain" are different facts -
    // conflating them is exactly the misreporting #913 calls out.
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
            {detail.reason === "not_registered" ? "Contract Not Found" : "Registry Unavailable"}
          </h1>
          <p style={{ fontFamily: "var(--font-sans)", fontSize: "15px", color: "var(--muted2)" }}>
            {detail.reason === "not_registered" ? (
              <>
                No spec registered on chain for <code>{contractId}</code>.
              </>
            ) : (
              <>Could not read the registry contract: {detail.error}</>
            )}
          </p>
        </div>
      </section>
    );
  }

  const spec = detail.spec;
  const records = detail.records;
  const currentRecord = records[records.length - 1];
  const label = getLabelRecords().find((l) => l.contractId === contractId);
  const recentEvents = await getRecentContractEvents(contractId, spec, 10);

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
            {spec.name}
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
              <dd style={{ color: "#fff", margin: 0, wordBreak: "break-all" }}>
                <a
                  href={stellarExpertContractUrl(contractId)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#fff", textDecoration: "underline" }}
                >
                  {contractId}
                </a>
              </dd>
              <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Version</dt>
              <dd style={{ color: "#fff", margin: 0 }}>{spec.version}</dd>
              <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Network</dt>
              <dd style={{ color: "#fff", margin: 0 }}>{spec.network ?? "unknown"}</dd>
              {currentRecord && (
                <>
                  <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Publisher</dt>
                  <dd style={{ color: "#fff", margin: 0, wordBreak: "break-all" }}>
                    <a
                      href={stellarExpertAccountUrl(currentRecord.publisher)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#fff", textDecoration: "underline" }}
                    >
                      {currentRecord.publisher}
                    </a>
                  </dd>
                  <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Spec Hash</dt>
                  <dd style={{ color: "#fff", margin: 0, wordBreak: "break-all" }}>
                    <a
                      href={currentRecord.pointer}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#fff", textDecoration: "underline" }}
                    >
                      {currentRecord.specHash}
                    </a>
                  </dd>
                </>
              )}
              {label && (
                <>
                  <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Labels</dt>
                  <dd style={{ color: "#fff", margin: 0 }}>
                    {label.category}
                    {label.tags.length > 0 ? ` · ${label.tags.join(", ")}` : ""}
                    {label.verified ? " · verified" : ""}
                  </dd>
                </>
              )}
              <dt style={{ color: "var(--muted)", fontSize: "11px", marginTop: "8px" }}>Fetched</dt>
              <dd style={{ color: "var(--muted2)", margin: 0, fontSize: "11px" }}>
                {new Date(detail.fetchedAt).toISOString()}
              </dd>
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
            Version History ({records.length})
          </div>
          <div style={{ padding: "16px" }}>
            {[...records].reverse().map((record, i) => (
              <div
                key={`${record.version}-${record.publishedAtLedger}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr 100px",
                  gap: "12px",
                  alignItems: "baseline",
                  padding: "8px 0",
                  borderBottom: i < records.length - 1 ? "1px solid var(--border)" : "none",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: "#fff", fontWeight: 700 }}>{record.version}</span>
                <a
                  href={record.pointer}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--muted2)", textDecoration: "underline", wordBreak: "break-all" }}
                  title={record.specHash}
                >
                  {record.specHash.slice(0, 16)}…
                </a>
                <span style={{ color: "var(--muted)", textAlign: "right" }}>
                  ledger {record.publishedAtLedger}
                </span>
              </div>
            ))}
          </div>
        </div>

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

        {spec.functions.length > 0 && (
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
              Functions ({spec.functions.length})
            </div>
            <div style={{ padding: "16px" }}>
              {spec.functions.map((fn, i) => (
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

        {spec.events.length > 0 && (
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
              Events ({spec.events.length})
            </div>
            <div style={{ padding: "16px" }}>
              {spec.events.map((ev, i) => (
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
            Recent Events
          </div>
          <div style={{ padding: "16px" }}>
            {!recentEvents.available ? (
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "#facc15",
                  margin: 0,
                }}
              >
                Could not read recent events from chain: {recentEvents.error}
              </p>
            ) : recentEvents.events.length === 0 ? (
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "var(--muted)",
                  margin: 0,
                }}
              >
                No events found on chain between ledger {recentEvents.windowStartLedger} and{" "}
                {recentEvents.latestLedger}.
              </p>
            ) : (
              <>
                {recentEvents.events.map((ev) => (
                  <div
                    key={ev.id}
                    style={{
                      marginBottom: "12px",
                      borderBottom: "1px solid var(--border)",
                      paddingBottom: "12px",
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px",
                      }}
                    >
                      <span style={{ color: "var(--muted)" }}>ledger {ev.ledger}</span>
                      {ev.semantic && (
                        <span
                          style={{
                            color: "#4ade80",
                            fontWeight: 700,
                            padding: "1px 6px",
                            border: "1px solid #1a4a1a",
                            fontSize: "11px",
                          }}
                        >
                          {ev.semantic.name}
                        </span>
                      )}
                      {ev.txHash && (
                        <a
                          href={`https://stellar.expert/explorer/${
                            (process.env.ORBITAL_NETWORK ?? "testnet") === "mainnet"
                              ? "public"
                              : "testnet"
                          }/tx/${ev.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--muted2)", textDecoration: "underline" }}
                        >
                          {ev.txHash.slice(0, 10)}…
                        </a>
                      )}
                    </div>
                    {ev.decoded !== undefined ? (
                      <pre
                        style={{
                          fontFamily: "var(--font-mono)",
                          background: "var(--surface2)",
                          padding: "8px",
                          border: "1px solid var(--border)",
                          color: "#fff",
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-all",
                          fontSize: "11px",
                        }}
                      >
                        {JSON.stringify(ev.decoded, null, 2)}
                      </pre>
                    ) : ev.decodeError ? (
                      <p style={{ color: "var(--muted)", fontSize: "11px", margin: 0 }}>
                        Not decoded: {ev.decodeError}
                      </p>
                    ) : (
                      <p style={{ color: "var(--muted)", fontSize: "11px", margin: 0 }}>
                        {ev.topics.length} topic(s), no spec to decode against.
                      </p>
                    )}
                  </div>
                ))}
                {recentEvents.truncated && (
                  <p style={{ color: "var(--muted)", fontSize: "11px", margin: 0 }}>
                    More events exist in this window than shown.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
