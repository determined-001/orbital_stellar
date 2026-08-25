#!/usr/bin/env node
/**
 * Asserts that no server-side secret reaches the Next.js *client* bundle.
 *
 * Supersedes assert-demo-secret-not-in-bundle.mjs, which only covered
 * DEMO_EMITTER_SECRET. Every secret the web app can read is checked, so adding
 * a new one to SECRET_ENV_VARS is all it takes to bring it under the gate.
 *
 * Run after `pnpm --filter orbital/web run build`, with canary values set for
 * the build *and* for this check:
 *
 *   export DEMO_EMITTER_SECRET='SDEMOSECRET_CANARY_DO_NOT_SHIP_0000000000000000'
 *   pnpm --filter orbital/web run build
 *   node scripts/assert-no-secrets-in-bundle.mjs
 *
 * Only `apps/web/.next/static` is scanned - those are the files a browser
 * downloads. Server chunks may legitimately reference a secret.
 *
 * Exit codes: 0 clean, 1 a secret leaked, 2 the check could not run.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATIC_DIR = join(ROOT, "apps/web/.next/static");

/**
 * Secrets the web app's server runtime can read. Anything added here is
 * checked; anything not here is not, so keep it in step with SECURITY.md.
 */
const SECRET_ENV_VARS = [
  "DEMO_EMITTER_SECRET",
  "SOROBAN_INVOKER_SECRET",
  "ORBITAL_REGISTRY_PUBLISHER_SECRET",
  "UPSTASH_REDIS_REST_TOKEN",
  "NPM_TOKEN",
];

/** A value shorter than this is not distinctive enough to grep for safely. */
const MIN_CANARY_LENGTH = 16;

if (!existsSync(STATIC_DIR)) {
  console.error(`assert-no-secrets-in-bundle: missing ${STATIC_DIR} - run the web build first.`);
  process.exit(2);
}

const present = SECRET_ENV_VARS.map((name) => ({ name, value: process.env[name] })).filter(
  (entry) => typeof entry.value === "string" && entry.value.length > 0,
);

if (present.length === 0) {
  console.error(
    `assert-no-secrets-in-bundle: none of ${SECRET_ENV_VARS.join(", ")} is set. ` +
      `Set at least one canary value (>= ${MIN_CANARY_LENGTH} chars) to the same value used for the build.`,
  );
  process.exit(2);
}

const tooShort = present.filter((entry) => entry.value.length < MIN_CANARY_LENGTH);
if (tooShort.length > 0) {
  console.error(
    `assert-no-secrets-in-bundle: ${tooShort
      .map((entry) => entry.name)
      .join(", ")} shorter than ${MIN_CANARY_LENGTH} chars - too short to grep for reliably.`,
  );
  process.exit(2);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(STATIC_DIR);
const leaks = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary or unreadable asset
  }
  for (const { name, value } of present) {
    if (text.includes(value)) {
      leaks.push({ name, file: relative(ROOT, file) });
    }
  }
}

if (leaks.length > 0) {
  console.error("Secret values found in the client bundle (.next/static):");
  for (const leak of leaks) {
    // The variable name, never the value.
    console.error(`  - ${leak.name} in ${leak.file}`);
  }
  process.exit(1);
}

console.log(
  `ok: none of ${present.map((entry) => entry.name).join(", ")} present in ` +
    `apps/web/.next/static (${files.length} files scanned)`,
);
