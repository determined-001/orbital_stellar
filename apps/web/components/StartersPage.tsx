"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { GITHUB_REPO, exampleTreeUrl } from "@/lib/links";

/**
 * The starters live in this monorepo under `examples/`, not in repos of their
 * own. They used to be listed as `determined-001/orbital-<name>` - three repos
 * that do not exist, so every source link 404'd and every deploy button cloned
 * nothing. Pointing at `examples/` keeps one repo to maintain and makes the
 * links true.
 */
interface Starter {
  /** Directory under `examples/`. Also the display name. */
  dir: string;
  description: string;
  packages: string[];
  what: string;
  /**
   * Vercel's clone flow can target a subdirectory of a monorepo via
   * `root-directory`, so the Next.js starter keeps a working one-click.
   * Railway's `templateUrl` deploy link has no equivalent - it clones the repo
   * root - so the two Node services link to their README instead of shipping a
   * button that silently deploys the wrong thing.
   */
  deploy: { kind: "vercel" } | { kind: "readme" };
}

const STARTERS: Starter[] = [
  {
    dir: "next-starter",
    description:
      "A Next.js app with real-time Stellar event subscriptions. Subscribe to any address over SSE and render live payment and operation updates.",
    packages: ["@orbital-stellar/pulse-core", "@orbital-stellar/pulse-notify"],
    what: "Real-time Stellar event UI with React hooks",
    deploy: { kind: "vercel" },
  },
  {
    dir: "express-starter",
    description:
      "An Express server that ingests Stellar events, persists a cursor, and delivers HMAC-signed webhooks, with a receiver that verifies them. The composition from docs/COOKBOOK.md, in code that compiles.",
    packages: ["@orbital-stellar/pulse-core", "@orbital-stellar/pulse-webhooks"],
    what: "Webhook delivery server with signed payloads",
    deploy: { kind: "readme" },
  },
  {
    dir: "anchor-starter",
    description:
      "Audit-grade, replay-safe event capture for Stellar anchors. Captures payment and trustline events for a set of distribution accounts into an append-only JSON Lines audit log that an auditor can replay byte-identically.",
    packages: ["@orbital-stellar/pulse-core", "@orbital-stellar/pulse-webhooks"],
    what: "Replayable append-only anchor audit log",
    deploy: { kind: "readme" },
  },
];

function deployHref(starter: Starter): string {
  if (starter.deploy.kind === "vercel") {
    const params = new URLSearchParams({
      "repository-url": GITHUB_REPO,
      "root-directory": `examples/${starter.dir}`,
      "project-name": `orbital-${starter.dir}`,
      "repository-name": `orbital-${starter.dir}`,
    });
    return `https://vercel.com/new/clone?${params.toString()}`;
  }
  return `${exampleTreeUrl(starter.dir)}#readme`;
}

function DeployButton({ starter }: { starter: Starter }) {
  const target = starter.deploy.kind === "vercel" ? "Vercel" : "Railway";
  const label =
    starter.deploy.kind === "vercel" ? "Deploy to Vercel" : "Read the deploy guide";

  return (
    <a
      href={deployHref(starter)}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "8px",
        background: target === "Vercel" ? "#fff" : "#0B0D0E",
        color: target === "Vercel" ? "#000" : "#fff",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: "13px",
        padding: "10px 22px",
        textDecoration: "none",
        border: target === "Railway" ? "1px solid rgba(255,255,255,0.15)" : "none",
        transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
    >
      {target === "Vercel" ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 116 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M57.5 0L115 100H0L57.5 0Z" fill="currentColor" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="2" y="2" width="20" height="20" rx="4" fill="currentColor" />
          <path
            d="M8 8h8M8 12h8M8 16h8"
            stroke={target === "Railway" ? "#0B0D0E" : "#fff"}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      {label}
    </a>
  );
}

function StarterCard({ starter }: { starter: Starter }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--surface)",
        border: `1px solid ${hovered ? "var(--border-hover)" : "var(--border)"}`,
        padding: "36px",
        display: "flex",
        flexDirection: "column",
        transition: "border-color 0.15s",
      }}
    >
      {/* Source path - linked, so the card is a way into the code and not just a label */}
      <a
        href={exampleTreeUrl(starter.dir)}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
          color: "var(--accent)",
          textDecoration: "none",
          marginBottom: "16px",
          display: "block",
        }}
      >
        examples/{starter.dir} →
      </a>

      {/* Description */}
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "15px",
          color: "var(--muted2)",
          lineHeight: 1.7,
          marginBottom: "24px",
          flex: 1,
        }}
      >
        {starter.description}
      </p>

      {/* What it demonstrates */}
      <div
        style={{
          background: "var(--surface2)",
          padding: "14px 18px",
          marginBottom: "20px",
          borderLeft: "2px solid var(--accent)",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "4px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Demonstrates
        </p>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "14px",
            color: "#fff",
            fontWeight: 500,
          }}
        >
          {starter.what}
        </p>
      </div>

      {/* Packages */}
      <div style={{ marginBottom: "24px" }}>
        <p
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "12px",
            color: "var(--muted)",
            marginBottom: "8px",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Packages
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          {starter.packages.map((pkg) => (
            <span
              key={pkg}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--muted2)",
                background: "var(--surface2)",
                padding: "4px 10px",
                border: "1px solid var(--border)",
              }}
            >
              {pkg}
            </span>
          ))}
        </div>
      </div>

      {/* Deploy button */}
      <DeployButton starter={starter} />
    </div>
  );
}

export default function StartersPage() {
  return (
    <>
      <Nav />
      <main
        style={{
          paddingTop: "140px",
          paddingBottom: "100px",
          paddingLeft: "32px",
          paddingRight: "32px",
        }}
      >
        <div style={{ maxWidth: "var(--max-width)", margin: "0 auto" }}>
          {/* Header */}
          <div style={{ marginBottom: "64px", textAlign: "center" }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "12px",
                color: "var(--accent)",
                border: "1px solid rgba(232,255,71,0.3)",
                padding: "4px 12px",
                display: "inline-block",
                marginBottom: "24px",
                letterSpacing: "0.02em",
              }}
            >
              M5 · Starter boilerplates
            </span>
            <h1
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(2.5rem, 5vw, 4rem)",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                color: "#fff",
                margin: "0 auto 20px",
                maxWidth: "600px",
              }}
            >
              Fork a starter.
              <br />
              <em>Ship in minutes.</em>
            </h1>
            <p
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "17px",
                color: "var(--muted2)",
                maxWidth: "520px",
                lineHeight: 1.6,
                margin: "0 auto",
              }}
            >
              Three production-shaped repos that demonstrate the full Orbital SDK family. Pick your
              stack, click deploy, and have a working Stellar event pipeline running on free tier.
            </p>
          </div>

          {/* Cards grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "1px",
              background: "var(--border)",
              marginBottom: "48px",
            }}
          >
            {STARTERS.map((starter) => (
              <StarterCard key={starter.dir} starter={starter} />
            ))}
          </div>

          {/* Info text */}
          <p
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "13px",
              color: "var(--muted)",
              textAlign: "center",
              lineHeight: 1.6,
            }}
          >
            All starters are MIT-licensed and maintained alongside the Orbital SDKs. After
            deploying, check the starter&apos;s README for the next steps.
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
