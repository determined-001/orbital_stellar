import Link from "next/link";
import {
  getOperatorStore,
  scoreOperatorView,
  stellarExpertTxUrl,
  WORKER_SCORE_CONFIG,
} from "@/lib/workers";
import { ScoreBadge } from "@/components/workers/ScoreBadge";
import { StatCard } from "@/components/workers/StatCard";
import { LatencyChart } from "@/components/workers/LatencyChart";
import { VerdictList } from "@/components/workers/VerdictList";

export const dynamic = "force-dynamic";

export default async function OperatorPage({ params }: { params: Promise<{ operator: string }> }) {
  const { operator } = await params;
  const store = getOperatorStore();
  const all = store.getForOperator(operator);

  if (all.length === 0) {
    return (
      <section style={{ padding: "120px 32px" }}>
        <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
          <Link href="/workers" style={backLink}>
            ← All operators
          </Link>
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
            No verdicts yet
          </h1>
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "15px",
              color: "var(--muted2)",
              maxWidth: "620px",
              lineHeight: 1.6,
            }}
          >
            <code style={{ fontFamily: "var(--font-mono)" }}>{operator}</code> has not recorded any
            verdicts. Once it completes jobs, its uptime, latency and miss-rate will appear here.
            This is an empty state by design - we do not fabricate a score for an operator with no
            history.
          </p>
        </div>
      </section>
    );
  }

  const { verdicts, score, metrics } = scoreOperatorView(operator);
  const label = all[all.length - 1]?.label ?? operator;
  const verdictHref = `/workers/${operator}#verdicts`;

  return (
    <section style={{ padding: "120px 32px" }}>
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <Link href="/workers" style={backLink}>
          ← All operators
        </Link>

        {score.status === "insufficient_data" ? (
          <>
            <h1
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
                color: "#fff",
                lineHeight: 1.1,
                letterSpacing: "-0.01em",
                margin: "16px 0 8px",
              }}
            >
              {label}
            </h1>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--muted)",
                marginBottom: "24px",
              }}
            >
              {operator}
            </p>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                padding: "24px",
                maxWidth: "620px",
              }}
            >
              <h2
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "13px",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: "12px",
                }}
              >
                Insufficient data
              </h2>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "15px",
                  color: "var(--muted2)",
                  lineHeight: 1.6,
                }}
              >
                This operator has <strong style={{ color: "#fff" }}>{score.samples}</strong>{" "}
                verdicts in the window. A score is shown only after{" "}
                <strong style={{ color: "#fff" }}>{score.minSamples}</strong> (
                {Math.max(0, score.minSamples - score.samples)} more needed). We never show a
                default or penalty score for a new operator.
              </p>
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--muted)",
                  marginTop: "16px",
                }}
              >
                formula {score.formulaVersion}
              </p>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                marginTop: "16px",
                marginBottom: "8px",
                flexWrap: "wrap",
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
                {label}
              </h1>
              <ScoreBadge score={score} />
            </div>
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--muted)",
                marginBottom: "8px",
              }}
            >
              {operator} · formula {score.formulaVersion}
            </p>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--muted2)",
                marginBottom: "24px",
              }}
            >
              Score window: last {Math.round(WORKER_SCORE_CONFIG.windowMs / 86_400_000)}d ·{" "}
              {score.samples} verdicts · {score.contributors.length} verdicts moved the score.
            </p>

            {/* Stat cards - each links to the verdicts that produced it */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: "16px",
                marginBottom: "32px",
              }}
            >
              <StatCard
                label="Uptime"
                value={(score.components.availability * 100).toFixed(1)}
                unit="%"
                href={verdictHref}
                sub={`${metrics.successes} ok / ${metrics.misses} miss`}
              />
              <StatCard
                label="p50 latency"
                value={metrics.latencyP50Ms === null ? "—" : `${Math.round(metrics.latencyP50Ms)}`}
                unit={metrics.latencyP50Ms === null ? "" : "ms"}
                href={verdictHref}
              />
              <StatCard
                label="p95 latency"
                value={metrics.latencyP95Ms === null ? "—" : `${Math.round(metrics.latencyP95Ms)}`}
                unit={metrics.latencyP95Ms === null ? "" : "ms"}
                href={verdictHref}
                sub={`target ${WORKER_SCORE_CONFIG.latencyTargetMs}ms`}
              />
              <StatCard
                label="Miss rate"
                value={(score.components.missRate * 100).toFixed(1)}
                unit="%"
                href={verdictHref}
              />
            </div>

            {/* Latency distribution */}
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
                Latency distribution (successful verdicts)
              </div>
              <div style={{ padding: "16px" }}>
                <LatencyChart
                  latencies={verdicts
                    .filter((v) => v.outcome === "success")
                    .map((v) => v.latencyMs)}
                />
              </div>
            </div>

            {/* What moved this score - links to the exact verdicts */}
            {score.contributors.length > 0 && (
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
                  What moved this score
                </div>
                <div style={{ padding: "12px 16px" }}>
                  {score.contributors.map((c) => (
                    <div
                      key={c.verdict.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "6px 0",
                        borderBottom: "1px solid var(--border)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "12px",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-sans)",
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          border: `1px solid ${c.reason === "miss" ? "#4a1a1a" : "#4a3a00"}`,
                          background: c.reason === "miss" ? "#2a0a0a" : "#2a2a00",
                          color: c.reason === "miss" ? "#ff5370" : "#facc15",
                        }}
                      >
                        {c.reason === "miss" ? "✕ MISS" : "⏱ SLOW"}
                      </span>
                      <Link
                        href={`/workers/${operator}#v-${c.verdict.id}`}
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                      >
                        {c.verdict.id}
                      </Link>
                      <span style={{ color: "var(--muted)" }}>{c.impact.toFixed(1)} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent verdicts */}
            <div
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
              id="verdicts"
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
                Recent verdicts ({verdicts.length})
              </div>
              <VerdictList verdicts={verdicts} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

const backLink: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: "13px",
  color: "var(--muted2)",
  textDecoration: "none",
};
