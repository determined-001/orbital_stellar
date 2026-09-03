#!/usr/bin/env node
/**
 * Custody gate: refuses code that gives a worker signing authority over a
 * user's account.
 *
 * §C.2 rule 3 - a design that requires a worker to hold a user's key is a
 * design bug, not a feature. A worker's power is limited to "call a constrained
 * function", never "decide where money goes". Prose in a design doc gets
 * skimmed; this gets answered.
 *
 * The rule is deliberately NARROW. A broad heuristic that fires constantly
 * trains reviewers to click through it, which is worse than no gate at all, so
 * this matches only two things:
 *
 *   1. A FIELD DECLARATION whose name pairs a user-ish owner (user, subscriber,
 *      depositor, customer, client, account holder) with key material (secret,
 *      seed, keypair, private key, signing key). Mentions in prose, comments and
 *      string messages are not matched - only somewhere a value gets stored.
 *   2. A literal Stellar secret seed (S + 55 base32 chars) in a covered path.
 *
 * Usage:
 *   node scripts/check-no-user-custody.mjs                 # scan covered paths
 *   node scripts/check-no-user-custody.mjs --base origin/main   # changed files only
 *
 * Exit codes: 0 clean, 1 findings, 2 the check could not run.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Paths whose contents this gate covers.
 *
 * #1026 records that CI path filters have silently missed `contracts/`, `data/`
 * and `scripts/` before, and a skipped required check reports as success. Any
 * path added here must also be added to `.github/workflows/custody-gate.yml`'s
 * `paths:` list, or the gate never runs on it.
 */
const COVERED = [
  "packages/worker-core",
  "packages/pulse-core",
  "contracts/vault",
  "contracts/payroll",
  "contracts/registry",
  "scripts",
];

const EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".rs", ".json", ".yaml", ".yml", ".toml"]);

const OWNER = "(?:user|users|subscriber|subscribers|depositor|depositors|customer|customers|client|clients|account_?holder|owner)";
const MATERIAL = "(?:secret(?:_?key)?|seed|keypair|key_?pair|private_?key|signing_?key|secret_?seed|mnemonic)";

/** camelCase (userSecretKey) and snake_case (user_secret_key) field names. */
const FIELD_NAME = new RegExp(`\\b${OWNER}[_]?${MATERIAL}\\b`, "i");

/**
 * Identifiers that are being *declared or assigned* on a line, rather than
 * merely mentioned. This is what keeps "never store a user secret" in a doc
 * comment - or in an error message - from failing the build.
 *
 * JSON keys are quoted, so they are matched as quoted keys. Everywhere else
 * string literals are stripped first, so text inside a message cannot match.
 */
const JSON_KEY = /"([A-Za-z_][\w-]*)"\s*:/g;
const BARE_KEY = /\b([A-Za-z_$][\w$]*)\s*\??\s*[:=]/g;
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/** Names being declared or assigned on this line. */
function declaredNames(line, isJson) {
  const names = [];
  if (isJson) {
    for (const m of line.matchAll(JSON_KEY)) names.push(m[1]);
    return names;
  }
  const stripped = line.replace(STRING_LITERAL, '""');
  for (const m of stripped.matchAll(BARE_KEY)) names.push(m[1]);
  return names;
}

/** A comment line carries no stored value, so it cannot create custody. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*|#|--)/;

/** Stellar secret seeds are unambiguous wherever they appear. */
const SEED_LITERAL = /\bS[A-Z2-7]{55}\b/;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "target" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

function coveredFiles() {
  const out = [];
  for (const dir of COVERED) {
    const full = join(ROOT, dir);
    if (existsSync(full)) walk(full, out);
  }
  return out;
}

function changedFiles(base) {
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (err) {
    console.error(`check-no-user-custody: could not diff against ${base}: ${err.message}`);
    process.exit(2);
  }
  return diff
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => COVERED.some((dir) => p === dir || p.startsWith(`${dir}/`)))
    .filter((p) => EXTENSIONS.has(extname(p)))
    .map((p) => join(ROOT, p))
    .filter((p) => existsSync(p));
}

function scan(files) {
  const findings = [];
  for (const file of files) {
    let lines;
    try {
      lines = readFileSync(file, "utf8").split("\n");
    } catch {
      continue;
    }
    const isJson = extname(file) === ".json";
    lines.forEach((line, i) => {
      if (line.length > 2000) return;
      if (SEED_LITERAL.test(line) && !COMMENT.test(line)) {
        findings.push({ file: relative(ROOT, file), line: i + 1, text: line.trim().slice(0, 120), why: "a literal Stellar secret seed" });
        return;
      }
      if (COMMENT.test(line)) return;
      if (!FIELD_NAME.test(line)) return;
      if (!declaredNames(line, isJson).some((name) => FIELD_NAME.test(name))) return;
      findings.push({
        file: relative(ROOT, file),
        line: i + 1,
        text: line.trim().slice(0, 120),
        why: "a field that would store a user's key material",
      });
    });
  }
  return findings;
}

const baseIndex = process.argv.indexOf("--base");
const base = baseIndex !== -1 ? process.argv[baseIndex + 1] : undefined;
const files = base ? changedFiles(base) : coveredFiles();

if (files.length === 0) {
  console.log("check-no-user-custody: no covered files changed - nothing to check.");
  process.exit(0);
}

const findings = scan(files);

if (findings.length === 0) {
  console.log(`check-no-user-custody: ${files.length} file(s) checked, no custody fields found.`);
  process.exit(0);
}

console.error("");
console.error("Custody gate: this change looks like it gives a worker a user's key.");
console.error("");
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}  ${f.why}`);
  console.error(`      ${f.text}`);
}
console.error("");
console.error("Why this is blocked (§C.2 rule 3):");
console.error("  A design that requires a worker to hold signing authority over a user's");
console.error("  account is a design bug, not a feature. A worker's power must be limited to");
console.error("  \"call a constrained function\", never \"decide where money goes\". If a worker");
console.error("  holds the key, the product is custody wearing a different name.");
console.error("");
console.error("What to do instead:");
console.error("  Have the user deposit into a constrained Soroban vault and grant the worker");
console.error("  permission to call one bounded function on it - allow-listed pools and assets,");
console.error("  a max-slippage bound, withdrawals only ever back to the depositor, and");
console.error("  revocation the depositor can exercise unilaterally.");
console.error("");
console.error("  See docs/design/workers.md#c2-no-user-custody");
console.error("");
console.error("If this is a genuine false positive, a reviewer can apply the");
console.error("`custody-reviewed` label to the PR after checking it. The gate is advisory:");
console.error("it is not a required check, and the label makes it pass.");
console.error("");
process.exit(1);
