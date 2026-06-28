#!/usr/bin/env node
/**
 * Generates the auto-generated API reference (TypeDoc + markdown) for the
 * three public packages and writes it into apps/web/content/reference/,
 * where the /reference/[[...slug]] route serves it.
 *
 * typedoc and typedoc-plugin-markdown aren't installed yet (pending a
 * maintainer follow-up that adds them as devDependencies and wires CI).
 * Until then this is a no-op so it doesn't break `next dev`/`next build`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

try {
  execFileSync("pnpm", ["exec", "typedoc", "--version"], { cwd: repoRoot, stdio: "ignore" });
} catch {
  console.log(
    "typedoc is not installed yet — skipping reference doc generation (see scripts/generate-reference-docs.mjs).",
  );
  process.exit(0);
}
const outRoot = "apps/web/content/reference";
const sourceLinkTemplate =
  "https://github.com/determined-001/orbital_stellar/blob/{gitRevision}/{path}#L{line}";

const packages = [
  {
    name: "pulse-core",
    tsconfig: "packages/pulse-core/tsconfig.json",
    entryPoints: ["packages/pulse-core/src/index.ts"],
  },
  {
    name: "pulse-webhooks",
    tsconfig: "packages/pulse-webhooks/tsconfig.json",
    entryPoints: ["packages/pulse-webhooks/src/index.ts"],
  },
  {
    name: "pulse-notify",
    tsconfig: "packages/pulse-notify/tsconfig.json",
    entryPoints: ["packages/pulse-notify/src/index.ts", "packages/pulse-notify/src/devtools.tsx"],
  },
];

// pulse-webhooks and pulse-notify import types from @orbital-stellar/pulse-core's
// built dist/, so it must exist before TypeDoc resolves their entry points.
console.log("Building pulse-core (dependency of the other packages' public types)...");
execFileSync("pnpm", ["exec", "tsc", "-p", "packages/pulse-core/tsconfig.json"], {
  cwd: repoRoot,
  stdio: "inherit",
});

for (const pkg of packages) {
  console.log(`Generating reference docs for ${pkg.name}...`);
  execFileSync(
    "pnpm",
    [
      "exec",
      "typedoc",
      "--plugin",
      "typedoc-plugin-markdown",
      ...pkg.entryPoints.flatMap((entry) => ["--entryPoints", entry]),
      "--tsconfig",
      pkg.tsconfig,
      "--out",
      path.join(outRoot, pkg.name),
      "--readme",
      "none",
      "--name",
      pkg.name,
      "--gitRevision",
      "main",
      "--sourceLinkTemplate",
      sourceLinkTemplate,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
}
