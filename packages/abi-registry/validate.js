/**
 * validate.js — Validates all well-known ABI spec files against schema.json.
 *
 * Usage:
 *   node validate.js
 *
 * Exit codes:
 *   0  All specs pass validation.
 *   1  One or more specs fail validation, or a file cannot be read/parsed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMA_PATH = resolve(__dirname, "specs/well-known/schema.json");
const SPECS_DIR   = resolve(__dirname, "specs/well-known");

// Files that are not contract specs and should be skipped.
const SKIP = new Set(["schema.json", "index.json"]);

// ---------------------------------------------------------------------------
// Load schema
// ---------------------------------------------------------------------------
let schema;
try {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
} catch (err) {
  process.stderr.write(`[validate] Cannot read schema: ${SCHEMA_PATH}\n  ${err.message}\n`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

// ---------------------------------------------------------------------------
// Discover spec files
// ---------------------------------------------------------------------------
let files;
try {
  files = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".json") && !SKIP.has(f))
    .sort();
} catch (err) {
  process.stderr.write(`[validate] Cannot read specs directory: ${SPECS_DIR}\n  ${err.message}\n`);
  process.exit(1);
}

if (files.length === 0) {
  process.stderr.write(`[validate] No spec files found in ${SPECS_DIR}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate each spec
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;

for (const file of files) {
  const filePath = join(SPECS_DIR, file);
  let data;

  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    process.stderr.write(`[validate] FAIL  ${file}\n  Parse error: ${err.message}\n`);
    failed++;
    continue;
  }

  const valid = validate(data);

  if (valid) {
    process.stdout.write(`[validate] PASS  ${file}\n`);
    passed++;
  } else {
    process.stderr.write(`[validate] FAIL  ${file}\n`);
    for (const error of validate.errors) {
      const field = error.instancePath || "(root)";
      process.stderr.write(`  ${field}: ${error.message}\n`);
    }
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
process.stdout.write(`\n[validate] ${passed} passed, ${failed} failed (${files.length} total)\n`);

if (failed > 0) {
  process.exit(1);
}
