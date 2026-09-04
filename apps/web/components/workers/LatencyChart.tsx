/**
 * Latency distribution of successful verdicts, as a bucketed bar chart.
 *
 * Accessibility: the figure has a `role="img"` + `aria-label` summary, every bar
 * is labelled with its bucket range and a count, and a parallel `<table>` carries
 * the same numbers. The chart therefore reads without colour alone - the counts
 * and bucket labels are text, not just the bar fill.
 */
export function LatencyChart({ latencies }: { latencies: number[] }) {
  const bucketSize = 250;
  const buckets: { label: string; count: number }[] = [];

  if (latencies.length > 0) {
    const max = Math.max(...latencies);
    const bucketCount = Math.max(1, Math.ceil(max / bucketSize));
    for (let i = 0; i < bucketCount; i++) {
      const lo = i * bucketSize;
      const hi = lo + bucketSize;
      const count = latencies.filter((l) => l >= lo && l < hi).length;
      buckets.push({ label: `${lo}–${hi}ms`, count });
    }
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const min = latencies.length > 0 ? Math.min(...latencies) : 0;
  const max = latencies.length > 0 ? Math.max(...latencies) : 0;
  const summary = `${latencies.length} successful verdicts; shortest ${min}ms, longest ${max}ms.`;

  return (
    <figure style={{ margin: 0 }}>
      <div
        role="img"
        aria-label={`Latency distribution. ${summary} Buckets of ${bucketSize} milliseconds, counts labelled.`}
        style={{ display: "flex", flexDirection: "column", gap: "6px" }}
      >
        {buckets.length === 0 && (
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--muted)" }}>
            No successful verdicts in the window.
          </div>
        )}
        {buckets.map((b) => (
          <div key={b.label} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span
              style={{
                width: "86px",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "var(--muted)",
                flexShrink: 0,
              }}
            >
              {b.label}
            </span>
            <div
              style={{
                flex: 1,
                background: "var(--surface2)",
                height: "22px",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${(b.count / maxCount) * 100}%`,
                  height: "100%",
                  background: "var(--accent)",
                }}
              />
            </div>
            <span
              style={{
                width: "34px",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                color: "#fff",
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {b.count}
            </span>
          </div>
        ))}
      </div>

      <table style={{ width: "100%", marginTop: "12px", borderCollapse: "collapse" }}>
        <caption
          style={{
            textAlign: "left",
            fontFamily: "var(--font-sans)",
            fontSize: "11px",
            color: "var(--muted2)",
            marginBottom: "6px",
          }}
        >
          Latency distribution (counts per {bucketSize}ms bucket). {summary}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={thStyle}>
              Bucket
            </th>
            <th scope="col" style={thStyle}>
              Verdicts
            </th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.label}>
              <td style={tdStyle}>{b.label}</td>
              <td style={tdStyle}>{b.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  fontFamily: "var(--font-sans)",
  fontSize: "11px",
  color: "var(--muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "6px 8px",
  borderBottom: "1px solid var(--border)",
};

const tdStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  color: "#fff",
  padding: "6px 8px",
  borderBottom: "1px solid var(--border)",
};
