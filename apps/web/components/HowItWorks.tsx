const STEPS = [
  {
    num: "01",
    title: "Stellar Network",
    description: "Transaction confirmed on-chain and propagated across validators.",
  },
  {
    num: "02",
    title: "Horizon SSE",
    description: "One persistent global stream captures every ledger operation.",
  },
  {
    num: "03",
    title: "Orbital",
    description: "Filters by address, normalizes the payload, and routes to subscribers.",
  },
  {
    num: "04",
    title: "Your App",
    description: "Webhook fires or React hook updates - instantly.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" style={{ padding: "120px 32px" }}>
      <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(1.75rem, 3vw, 2.5rem)",
            color: "#fff",
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
            marginBottom: "48px",
            textAlign: "center",
          }}
        >
          How it works
        </h2>

        <div
          style={{
            display: "flex",
            border: "1px solid var(--border)",
            flexWrap: "wrap",
          }}
        >
          {STEPS.map((step, i) => (
            <div
              key={step.num}
              style={{
                flex: "1 1 200px",
                padding: "32px 24px",
                borderRight: i < STEPS.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "12px",
                  color: "var(--muted)",
                  marginBottom: "8px",
                }}
              >
                {step.num}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#fff",
                  marginBottom: "4px",
                }}
              >
                {step.title}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: "14px",
                  color: "var(--muted2)",
                  lineHeight: 1.6,
                }}
              >
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
