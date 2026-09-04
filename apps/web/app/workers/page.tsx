import Link from "next/link";
import type { OperatorReputationScore as OperatorScore } from "@orbital-stellar/worker-core";
import { getOperatorStore, scoreOperatorView, WORKER_SCORE_CONFIG } from "@/lib/workers";
import { ScoreBadge } from "@/components/workers/ScoreBadge";

export const dynamic = "force-dynamic";

type ScoredRow = {
  id: string;
  label: string;
  score: Extract<OperatorScore, { status: "scored" }>;
  metrics: ReturnType<typeof scoreOperatorView>["metrics"];
};

const PAGE_INTRO =
  "Every worker operator ranked by their trigger-without-custody reliability score. " +
  "The score is computed from chain-derived verdicts and version-stamped - see the " +
  "worker reputation design. Operators with too little history are separated below, " +
  "never ranked last with a default score.";

function MetricLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label="View the verdicts that produced this metric."
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "13px",
        color: "#fff",
        textDecoration: "none",
        borderBottom: "1px dotted var(--border)",
      }}
    >
      {children}
    </Link>
  );
}

export default async function WorkersPage() {
  const store = getOperatorStore();
  const asOf = Date.now();

  const rows = store.operatorIds().map((id) => {
    const { score, metrics } = scoreOperatorView(id, asOf);
    const label = store.getLatest(id)?.label ?? id;
    return { id, label, score, metrics };
  });

  const scored = rows
    .filter((r): r is ScoredRow => r.score.status === "scored")
    .sort((a, b) => b.score.score - a.score.score);
  const insufficient = rows.filter((r) => r.score.status !== "scored");

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
          Worker Operator Scorecards
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "15px",
            color: "var(--muted2)",
            lineHeight: 1.6,
            marginBottom: "32px",
            maxWidth: "680px",
          }}
        >
          {PAGE_INTRO}
        </p>

        {/* Ranked operators */}
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
              gridTemplateColumns: "60px 1fr 140px 90px 90px 90px 80px",
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
            <div style={{ padding: "12px 16px" }}>#</div>
            <div style={{ padding: "12px 8px" }}>Operator</div>
            <div style={{ padding: "12px 8px" }}>Score</div>
            <div style={{ padding: "12px 8px", textAlign: "center" }}>Uptime</div>
            <div style={{ padding: "12px 8px", textAlign: "center" }}>p95</div>
            <div style={{ padding: "12px 8px", textAlign: "center" }}>Miss</div>
            <div style={{ padding: "12px 8px", textAlign: "center" }}>N</div>
          </div>

          {scored.length === 0 && (
            <div
              style={{
                padding: "60px 16px",
                textAlign: "center",
                fontFamily: "var(--font-sans)",
                fontSize: "14px",
                color: "var(--muted)",
              }}
            >
              No operators scored yet.
            </div>
          )}

          {scored.map((r, i) => {
            const href = `/workers/${r.id}`;
            return (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "60px 1fr 140px 90px 90px 90px 80px",
                  borderBottom: "1px solid var(--border)",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    padding: "14px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "13px",
                    color: "var(--muted)",
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ padding: "14px 8px" }}>
                  <Link
                    href={href}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                      color: "#fff",
                      textDecoration: "none",
                      fontWeight: 700,
                    }}
                  >
                    {r.label}
                  </Link>
                  <span style={{ color: "var(--muted)", marginLeft: "8px", fontSize: "11px" }}>
                    {r.id}
                  </span>
                </div>
                <div style={{ padding: "12px 8px" }}>
                  <ScoreBadge score={r.score} />
                </div>
                <div style={{ padding: "12px 8px", textAlign: "center" }}>
                  <MetricLink href={`${href}#verdicts`}>
                    {(r.metrics.uptime * 100).toFixed(1)}%
                  </MetricLink>
                </div>
                <div style={{ padding: "12px 8px", textAlign: "center" }}>
                  <MetricLink href={`${href}#verdicts`}>
                    {r.metrics.latencyP95Ms === null
                      ? "—"
                      : `${Math.round(r.metrics.latencyP95Ms)}ms`}
                  </MetricLink>
                </div>
                <div style={{ padding: "12px 8px", textAlign: "center" }}>
                  <MetricLink href={`${href}#verdicts`}>
                    {(r.metrics.missRate * 100).toFixed(1)}%
                  </MetricLink>
                </div>
                <div
                  style={{
                    padding: "12px 8px",
                    textAlign: "center",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                    color: "var(--muted)",
                  }}
                >
                  {r.metrics.total}
                </div>
              </div>
            );
          })}
        </div>

        {/* Insufficient-data operators, clearly separated - not sorted last */}
        {insufficient.length > 0 && (
          <div style={{ marginTop: "40px" }}>
            <h2
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "1.25rem",
                color: "#fff",
                marginBottom: "4px",
              }}
            >
              Insufficient data
            </h2>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "13px",
                color: "var(--muted2)",
                marginBottom: "16px",
              }}
            >
              These operators have not yet earned enough verdicts to be scored. They are shown
              separately, never ranked with a default score.
            </p>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                overflow: "hidden",
              }}
            >
              {insufficient.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 120px 120px",
                    borderBottom: "1px solid var(--border)",
                    alignItems: "center",
                  }}
                >
                  <div style={{ padding: "14px 16px" }}>
                    <Link
                      href={`/workers/${r.id}`}
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "13px",
                        color: "#fff",
                        textDecoration: "none",
                        fontWeight: 700,
                      }}
                    >
                      {r.label}
                    </Link>
                    <span style={{ color: "var(--muted)", marginLeft: "8px", fontSize: "11px" }}>
                      {r.id}
                    </span>
                  </div>
                  <div style={{ padding: "12px 8px" }}>
                    <ScoreBadge score={r.score} />
                  </div>
                  <div
                    style={{
                      padding: "12px 8px",
                      textAlign: "center",
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                      color: "var(--muted)",
                    }}
                  >
                    {r.score.status === "insufficient_data"
                      ? `${r.score.samples}/${WORKER_SCORE_CONFIG.minSamples}`
                      : ""}{" "}
                    verdicts
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
