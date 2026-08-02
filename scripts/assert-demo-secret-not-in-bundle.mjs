#!/usr/bin/env node
/**
 * Asserts DEMO_EMITTER_SECRET never reaches the Next.js *client* bundle.
 *
 * Run after `pnpm --filter orbital/web run build` with a canary secret set
 * for the build (and again for this check):
 *
 *   export DEMO_EMITTER_SECRET='SDEMOSECRET_CANARY_DO_NOT_SHIP_000000000000000000000000000'
 *   pnpm --filter orbital/web run build
 *   node scripts/assert-demo-secret-not-in-bundle.mjs
 *
 * Greps `apps/web/.next/static` (browser assets). Server chunks may
 * legitimately reference the secret; client assets must never contain it.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATIC_DIR = join(ROOT, "apps/web/.next/static");
const SECRET = process.env.DEMO_EMITTER_SECRET;

if (!SECRET || SECRET.length < 16) {
  console.error(
    "assert-demo-secret-not-in-bundle: set DEMO_EMITTER_SECRET to the same canary value used for the build (≥16 chars).",
  );
  process.exit(2);
}

if (!existsSync(STATIC_DIR)) {
  console.error(
    `assert-demo-secret-not-in-bundle: missing ${STATIC_DIR} — run the web build first.`,
  );
  process.exit(2);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const hits = [];
for (const file of walk(STATIC_DIR)) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (text.includes(SECRET)) {
    hits.push(relative(ROOT, file));
  }
}

if (hits.length > 0) {
  console.error("DEMO_EMITTER_SECRET leaked into client bundle (.next/static):");
  for (const h of hits) console.error(`  - ${h}`);
  process.exit(1);
}

console.log("ok: DEMO_EMITTER_SECRET not present in apps/web/.next/static");
