#!/usr/bin/env node
/**
 * Prints the modules contributing most bytes to each browser-facing entry
 * point, newest-first by rendered size.
 *
 * `size-limit` reports the number and the delta against the budget; this
 * answers the follow-up question - which module moved it. CI runs this only
 * when the budget check fails, so a red build carries its own explanation.
 *
 * Usage:
 *   node scripts/why-size.mjs            # all entry points
 *   node scripts/why-size.mjs index      # one entry point
 */
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { relative } from "node:path";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const ENTRIES = ["index", "devtools", "vitePlugin"];
const TOP_N = 15;

const requested = process.argv.slice(2);
const entries = requested.length > 0 ? requested : ENTRIES;

function formatBytes(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(2)} kB` : `${bytes} B`;
}

for (const entry of entries) {
  const result = await build({
    logLevel: "silent",
    root: packageRoot,
    build: {
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(new URL(`../dist/${entry}.js`, import.meta.url)),
        formats: ["es"],
        fileName: entry,
      },
      // react/jsx-runtime is a separate specifier - match the whole family, or
      // React itself dominates the report and hides the package's own modules.
      rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] },
    },
  });

  const chunks = result[0].output.filter((output) => output.type === "chunk");
  const total = chunks.reduce((sum, chunk) => sum + chunk.code.length, 0);

  const modules = chunks
    .flatMap((chunk) => Object.entries(chunk.modules ?? {}))
    .map(([id, mod]) => ({ id, bytes: mod.renderedLength ?? 0 }))
    .filter((mod) => mod.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, TOP_N);

  console.log(`\n${entry}  -  ${formatBytes(total)} minified, ${modules.length} modules shown`);
  console.log("-".repeat(72));
  for (const mod of modules) {
    const share = total > 0 ? ((mod.bytes / total) * 100).toFixed(1) : "0.0";
    console.log(
      `${formatBytes(mod.bytes).padStart(10)}  ${String(share).padStart(5)}%  ${relative(packageRoot, mod.id)}`,
    );
  }
}
