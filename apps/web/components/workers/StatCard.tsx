import Link from "next/link";

/**
 * A metric rendered as a card that links to the verdicts that produced it. The
 * `aria-label` states the value and that it links to the underlying verdicts, so
 * the link target is clear without sight.
 */
export function StatCard({
  label,
  value,
  unit,
  href,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  href: string;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${label}: ${value}${unit ?? ""}. View the verdicts that produced this.`}
      style={{
        display: "block",
        textDecoration: "none",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        padding: "16px",
        transition: "border-color 0.15s",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "12px",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: "8px",
        }}
      >
        {label}
      </div>
      <div
        style={{ fontFamily: "var(--font-mono)", fontSize: "24px", color: "#fff", fontWeight: 700 }}
      >
        {value}
        <span style={{ fontSize: "13px", color: "var(--muted)" }}>{unit ?? ""}</span>
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "11px",
            color: "var(--muted2)",
            marginTop: "6px",
          }}
        >
          {sub}
        </div>
      )}
    </Link>
  );
}
