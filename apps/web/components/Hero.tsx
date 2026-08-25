"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { GITHUB_REPO } from "@/lib/links";

const ease = [0.22, 1, 0.36, 1] as const;

const fadeUp = (delay: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, ease, delay },
});

export default function Hero() {
  return (
    <section
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        paddingTop: "120px",
        paddingBottom: "80px",
        paddingLeft: "32px",
        paddingRight: "32px",
        textAlign: "center",
      }}
    >
      {/* Badge */}
      <motion.div {...fadeUp(0)}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            color: "var(--accent)",
            border: "1px solid rgba(232,255,71,0.3)",
            padding: "4px 12px",
            display: "inline-block",
            marginBottom: "28px",
            letterSpacing: "0.02em",
          }}
        >
          Real-time events for Stellar
        </span>
      </motion.div>

      {/* Headline */}
      <motion.h1
        {...fadeUp(0.1)}
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(3rem, 7vw, 6rem)",
          lineHeight: 1.0,
          letterSpacing: "-0.02em",
          color: "#fff",
          margin: 0,
          marginBottom: "24px",
        }}
      >
        The missing event layer.
        <br />
        <em>for Stellar developers.</em>
      </motion.h1>

      {/* Subheadline */}
      <motion.p
        {...fadeUp(0.2)}
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: "18px",
          color: "var(--muted2)",
          maxWidth: "480px",
          lineHeight: 1.6,
          margin: "0 auto 40px",
        }}
      >
        Subscribe to any address, receive webhooks, and build real-time apps - without running your
        own Horizon node.
      </motion.p>

      {/* Buttons */}
      <motion.div
        {...fadeUp(0.3)}
        style={{ display: "flex", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}
      >
        <Link
          href="/docs"
          style={{
            background: "var(--accent)",
            color: "#000",
            fontFamily: "var(--font-sans)",
            fontWeight: 700,
            fontSize: "14px",
            padding: "12px 28px",
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          Read the docs
        </Link>
        <Link
          href={GITHUB_REPO}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: "transparent",
            color: "#fff",
            fontFamily: "var(--font-sans)",
            fontWeight: 500,
            fontSize: "14px",
            padding: "12px 28px",
            textDecoration: "none",
            border: "1px solid var(--border-hover)",
            display: "inline-block",
          }}
        >
          View on GitHub →
        </Link>
      </motion.div>
    </section>
  );
}
