import { stellarExpertTxUrl, type OperatorVerdict } from "@/lib/workers";

function formatTime(at: number): string {
  return new Date(at).toLocaleString();
}

/**
 * Recent verdicts for an operator. Each row carries `id="v-<verdictId>"` so a
 * score's `contributors` can deep-link straight to the verdict that moved it.
 *
 * A miss is encoded with a shape (✕) AND a text label ("MISS"), never colour
 * alone, so the outcome is legible without colour vision.
 */
export function VerdictList({ verdicts }: { verdicts: OperatorVerdict[] }) {
  if (verdicts.length === 0) {
    return (
      <div
        style={{
          padding: "32px 16px",
          textAlign: "center",
          fontFamily: "var(--font-sans)",
          fontSize: "14px",
          color: "var(--muted)",
        }}
      >
        No verdicts in the window.
      </div>
    );
  }

  return (
    <div>
      {verdicts.map((v) => {
        const isMiss = v.outcome === "miss";
        return (
          <div
            key={v.id}
            id={`v-${v.id}`}
            style={{
              display: "grid",
              gridTemplateColumns: "110px 1fr 90px 70px",
              gap: "0",
              alignItems: "center",
              borderBottom: "1px solid var(--border)",
              padding: "10px 8px",
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
            }}
          >
            <div style={{ color: "var(--muted)" }}>{formatTime(v.at)}</div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                aria-label={isMiss ? "Miss" : "Success"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontFamily: "var(--font-sans)",
                  fontWeight: 700,
                  fontSize: "11px",
                  padding: "2px 8px",
                  border: `1px solid ${isMiss ? "#4a1a1a" : "#1a4a1a"}`,
                  background: isMiss ? "#2a0a0a" : "#0a2a0a",
                  color: isMiss ? "#ff5370" : "#4ade80",
                }}
              >
                <span aria-hidden>{isMiss ? "✕" : "✓"}</span>
                {isMiss ? "MISS" : "OK"}
              </span>
            </div>

            <div style={{ color: isMiss ? "var(--muted)" : "#fff" }}>
              {isMiss ? "—" : `${v.latencyMs}ms`}
            </div>

            <div style={{ textAlign: "right" }}>
              <a
                href={stellarExpertTxUrl(v.txHash)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "none" }}
              >
                tx ↗
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
