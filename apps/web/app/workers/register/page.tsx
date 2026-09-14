import Link from "next/link";

// Static documentation/link page - there is nothing here to fetch live.
// The submission flow itself is file-based (a pull request), not a web form:
// see the rationale in docs/workers/submitting.md.
export const dynamic = "force-static";

const REPO = "https://github.com/determined-001/orbital_stellar";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        padding: "20px",
        marginBottom: "16px",
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
        {title}
      </h3>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: "14px", color: "var(--muted2)", lineHeight: 1.7 }}>
        {children}
      </div>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{ color: "#fff", textDecoration: "underline" }}>
      {children}
    </a>
  );
}

export default function RegisterOperatorPage() {
  return (
    <section style={{ padding: "120px 32px" }}>
      <div style={{ maxWidth: "720px", margin: "0 auto" }}>
        <Link
          href="/workers"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--muted)",
            textDecoration: "none",
          }}
        >
          ← All operators
        </Link>
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
          Register as an Operator
        </h1>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "15px",
            color: "var(--muted2)",
            lineHeight: 1.6,
            marginBottom: "8px",
            maxWidth: "600px",
          }}
        >
          Getting an external worker operator into the registry: submission, automated
          validation, human review, publication - the same idiom the{" "}
          <ExternalLink href={`${REPO}/blob/main/docs/semantic-layer/submitting.md`}>
            semantic-layer submission flow
          </ExternalLink>{" "}
          uses.
        </p>
        <div
          style={{
            padding: "12px 16px",
            marginBottom: "32px",
            background: "#2a2a00",
            border: "1px solid #4a4a00",
            color: "#facc15",
            fontFamily: "var(--font-sans)",
            fontSize: "13px",
            lineHeight: 1.6,
          }}
        >
          <strong>Listing is not an endorsement.</strong> Orbital verifies your identity and
          that your target contract exists on chain - not your execution quality, uptime, or
          the accuracy of your declared terms. See the operator scorecards for reliability
          data instead.
        </div>

        <Card title="1. Signal intent (optional but recommended)">
          Open an{" "}
          <ExternalLink href={`${REPO}/issues/new?template=operator-submission.yml`}>
            Operator submission issue
          </ExternalLink>{" "}
          to let maintainers know you&apos;re coming, and to confirm your target contracts
          already resolve in the registry before you do the signing work below.
        </Card>

        <Card title="2. Prove you control your key">
          Submissions are gated on a signature: you sign the SHA-256 digest of your operator
          record with the private key of the <code>stellarAddress</code> you claim. This is
          the one check the automated gate never skips - without it, anyone could register an
          offering under someone else&apos;s identity and harvest their reputation.
        </Card>

        <Card title="3. Submit the records as a pull request">
          Add <code>operator.json</code> (and, if you have one, <code>offering.json</code>)
          under <code>data/operators/</code>, plus the <code>proof.json</code> from step 2.
          Full schemas, worked examples, and the exact proof format:{" "}
          <ExternalLink href={`${REPO}/blob/main/docs/workers/submitting.md`}>
            docs/workers/submitting.md
          </ExternalLink>
          .
        </Card>

        <Card title="4. Automated validation, then human review">
          <code>scripts/validate-operator-submission.mjs</code> checks your submission is
          schema-valid, your signature verifies, and any target contract resolves - every
          rejection carries a reason you can act on. A maintainer then reviews against the{" "}
          <ExternalLink href={`${REPO}/blob/main/docs/workers/submitting.md#human-review-rubric`}>
            published rubric
          </ExternalLink>
          : well-formedness, key ownership, no identity conflicts, and that your own copy
          doesn&apos;t claim an endorsement Orbital isn&apos;t making.
        </Card>

        <p style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted)", marginTop: "24px" }}>
          General PR workflow (forking, branch naming, the Stellar Wave Program):{" "}
          <ExternalLink href={`${REPO}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</ExternalLink>
        </p>
      </div>
    </section>
  );
}
