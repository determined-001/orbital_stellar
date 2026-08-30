import type { OperatorScore } from "@orbital-stellar/worker-core";

function scoreColor(s: number): string {
  if (s >= 800) return "#4ade80";
  if (s >= 600) return "#facc15";
  if (s >= 400) return "#fb923c";
  return "#ff5370";
}

/**
 * Compact score pill. The coloured dot is `aria-hidden`; the accessible text is
 * the number (or "insufficient data"), so the score is conveyed without colour
 * alone.
 */
export function ScoreBadge({ score }: { score: OperatorScore }) {
  const insufficient = score.status !== "scored";
  const text = insufficient ? "INSUFFICIENT DATA" : `${score.score} / 1000`;
  const color = insufficient ? "var(--muted)" : scoreColor(score.score);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        fontFamily: "var(--font-mono)",
        fontSize: "13px",
        fontWeight: 700,
        color: "#fff",
      }}
    >
      <span
        aria-hidden
        style={{ width: "10px", height: "10px", borderRadius: "50%", background: color }}
      />
      <span>{text}</span>
    </span>
  );
}
