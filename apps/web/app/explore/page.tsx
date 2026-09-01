"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const WELL_KNOWN_CONTRACTS = [
  { label: "USDC", contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75" },
  { label: "EURC", contractId: "CDTKPWPLOURQA2SGTKTUQOWRCBZEORB4BWBOMJ3D3ZTQQSGE5F6JBQLV" },
  { label: "AQUA", contractId: "CAUIKL3IYGMERDRUN5QQVPKPLZTRNVXV27LFCWQIRNOHSNGB3ZXAEFBX" },
] as const;

type SpecResult = {
  spec: { name?: string; version?: string; functions?: unknown[]; events?: unknown[] };
  specSource: string;
  publisher?: string;
  version?: string;
};

type ApiError = { error: string; message: string };

type LabelRecord = {
  contractId: string;
  name: string;
  description: string;
  network: string;
  tags: string[];
  category: string;
  verified: boolean;
};

type Status = "idle" | "loading" | "found" | "not_found" | "error";

async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, error: (body as ApiError) ?? { error: "unknown", message: `HTTP ${res.status}` } };
  }
  return { ok: true, data: body as T };
}

export default function ExplorePage() {
  const [contractId, setContractId] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [spec, setSpec] = useState<SpecResult | null>(null);
  const [label, setLabel] = useState<LabelRecord | null>(null);

  async function search(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    setStatus("loading");
    setErrorMsg("");
    setSpec(null);
    setLabel(null);

    const [specResult, labelsResult] = await Promise.all([
      fetchJson<SpecResult>(`/api/registry-data/spec/${encodeURIComponent(trimmed)}`),
      fetchJson<{ records: LabelRecord[] }>("/api/registry-data/labels"),
    ]);

    if (labelsResult.ok) {
      setLabel(labelsResult.data.records.find((r) => r.contractId === trimmed) ?? null);
    }

    if (!specResult.ok) {
      if (specResult.error.error === "not_found") {
        setStatus("not_found");
      } else {
        setStatus("error");
        setErrorMsg(specResult.error.message);
      }
      return;
    }

    setSpec(specResult.data);
    setStatus("found");
  }

  function handleSearch() {
    void search(contractId);
  }

  function handleWellKnown(id: string) {
    setContractId(id);
    void search(id);
  }

  return (
    <>
      <Nav />
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
            Registry Explorer
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
            Look up a contract's resolved ABI spec - bundled well-known specs today, the on-chain
            registry once it's deployed - plus its entity-label attribution, if any.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "8px",
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "12px",
                color: "var(--muted)",
                marginRight: "4px",
              }}
            >
              Try:
            </span>
            {WELL_KNOWN_CONTRACTS.map((token) => (
              <button
                key={token.contractId}
                onClick={() => handleWellKnown(token.contractId)}
                style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  color: "#fff",
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  fontWeight: 700,
                  padding: "6px 12px",
                  cursor: "pointer",
                }}
              >
                {token.label}
              </button>
            ))}
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
              <input
                type="text"
                value={contractId}
                onChange={(e) => setContractId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="C... (Soroban contract ID)"
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: "14px",
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  padding: "12px 16px",
                  outline: "none",
                }}
              />
              <button
                onClick={handleSearch}
                style={{
                  background: "var(--accent)",
                  color: "#000",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 700,
                  fontSize: "13px",
                  padding: "12px 20px",
                  border: "none",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Search
              </button>
            </div>

            <div style={{ minHeight: "200px", padding: "16px" }}>
              {status === "idle" && (
                <p style={emptyStateStyle}>Enter a contract ID to look up its spec.</p>
              )}
              {status === "loading" && <p style={emptyStateStyle}>Looking up…</p>}
              {status === "not_found" && (
                <p style={emptyStateStyle}>
                  No resolved spec for this contract yet. Bundled well-known specs cover USDC, EURC,
                  AQUA, and the native XLM wrapper; anything else needs the on-chain registry, which
                  isn't deployed yet.
                </p>
              )}
              {status === "error" && <p style={{ ...emptyStateStyle, color: "#FF5370" }}>{errorMsg}</p>}

              {status === "found" && spec && (
                <div style={{ fontFamily: "var(--font-sans)" }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      marginBottom: "16px",
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: "18px", fontWeight: 700, color: "#fff" }}>
                      {spec.spec.name ?? contractId.trim()}
                    </span>
                    <SourceBadge source={spec.specSource} />
                    {spec.version && <Chip>version {spec.version}</Chip>}
                    {spec.publisher && (
                      <Chip mono>
                        publisher {spec.publisher.slice(0, 8)}…{spec.publisher.slice(-4)}
                      </Chip>
                    )}
                  </div>

                  {label && (
                    <div
                      style={{
                        marginBottom: "16px",
                        padding: "12px",
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        fontSize: "13px",
                      }}
                    >
                      <strong style={{ color: "#fff" }}>{label.name}</strong>{" "}
                      <span style={{ color: "var(--muted)" }}>
                        ({label.category}, {label.network}
                        {label.verified ? ", verified" : ""})
                      </span>
                      <p style={{ color: "var(--muted2)", marginTop: "4px" }}>{label.description}</p>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: "24px", marginBottom: "12px", fontSize: "13px" }}>
                    <span style={{ color: "var(--muted)" }}>
                      {spec.spec.functions?.length ?? 0} functions
                    </span>
                    <span style={{ color: "var(--muted)" }}>{spec.spec.events?.length ?? 0} events</span>
                  </div>

                  <pre
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      color: "var(--muted2)",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      padding: "12px",
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {JSON.stringify(spec.spec, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px",
        fontWeight: 700,
        padding: "2px 8px",
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        color: "var(--accent)",
      }}
    >
      {source.toUpperCase()}
    </span>
  );
}

function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      style={{
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        fontSize: "12px",
        color: "var(--muted)",
        background: "var(--surface2)",
        border: "1px solid var(--border)",
        padding: "2px 8px",
      }}
    >
      {children}
    </span>
  );
}

const emptyStateStyle: import("react").CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "14px",
  color: "var(--muted)",
  textAlign: "center",
  marginTop: "60px",
};
