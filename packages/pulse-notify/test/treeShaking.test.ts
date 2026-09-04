// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Vite/Rollup resolve ids with POSIX separators. On Windows the native paths
// produced by fileURLToPath/join carry backslashes, which never match and the
// entry fails to resolve - so every path handed to Vite is normalized first.
const toPosix = (p: string): string => p.replace(/\\/g, "/");

const SRC_INDEX = toPosix(fileURLToPath(new URL("../src/index.ts", import.meta.url)));

/**
 * Bundles `source` against the package entry point and returns the emitted
 * JavaScript. Rollup's tree-shaking is what a consumer's bundler applies, so
 * anything still present here would ship in their client bundle.
 */
async function bundle(source: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "pulse-notify-treeshake-"));
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, source.replace("@entry", SRC_INDEX), "utf8");

  try {
    const result = (await build({
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        lib: { entry: toPosix(entry), formats: ["es"], fileName: "out" },
        rollupOptions: {
          external: ["react", "react-dom"],
          // The package ships "use client" banners; Rollup warns on every one
          // and they are irrelevant to what this file asserts.
          onwarn(warning, warn) {
            if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
            warn(warning);
          },
        },
      },
    })) as { output: { type: string; code?: string }[] }[];

    return result[0]!.output
      .filter((chunk) => chunk.type === "chunk")
      .map((chunk) => chunk.code ?? "")
      .join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("tree-shaking (#925)", () => {
  it("importing one hook does not pull in unrelated modules", async () => {
    const code = await bundle(
      `import { useStellarPayment } from "@entry";\nexport { useStellarPayment };\n`,
    );

    // Markers unique to modules a payment-only consumer never touches.
    expect(code).not.toContain("StellarConnectionStatus");
    expect(code).not.toContain("StellarEventBoundary");
    expect(code).not.toContain("useContractState");
    expect(code).not.toContain("useStellarEventSuspense");

    // Note: `wsTransport` IS still pulled in, because `useStellarEvent`
    // imports `acquireWsConnection` at module scope and picks the transport at
    // call time. Every SSE-only consumer therefore ships the WebSocket path.
    // Making that import lazy is a behaviour change, so it is left to a
    // follow-up rather than smuggled into this test.
  }, 60_000);

  it("a single-hook bundle is materially smaller than the full surface", async () => {
    const [single, full] = await Promise.all([
      bundle(`import { useStellarPayment } from "@entry";\nexport { useStellarPayment };\n`),
      bundle(`import * as all from "@entry";\nexport { all };\n`),
    ]);

    // Not a byte budget - .size-limit.json owns those. This asserts the shape
    // of the graph: pulling one hook must not drag the whole package along.
    expect(single.length).toBeLessThan(full.length * 0.75);
  }, 60_000);
});
