/**
 * validate.js - Validates all well-known ABI spec files against schema.json
 * and all label files in data/labels/ against label.schema.json.
 *
 * Usage:
 *   node validate.js
 *
 * Exit codes:
 *   0  All specs and labels pass validation.
 *   1  One or more specs or labels fail validation, or a file cannot be read/parsed.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Spec validation ──────────────────────────────────────────────────────────

const SCHEMA_PATH = resolve(__dirname, "specs/well-known/schema.json");
const SPECS_DIR = resolve(__dirname, "specs/well-known");

// Files that are not contract specs and should be skipped.
const SPEC_SKIP = new Set(["schema.json", "index.json"]);

// ---------------------------------------------------------------------------
// Load spec schema
// ---------------------------------------------------------------------------
let specSchema;
try {
  specSchema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
} catch (err) {
  process.stderr.write(`[validate] Cannot read spec schema: ${SCHEMA_PATH}\n  ${err.message}\n`);
  process.exit(1);
}

const ajv = new Ajv({ allErrors: true });
const validateSpec = ajv.compile(specSchema);

// ---------------------------------------------------------------------------
// Discover spec files
// ---------------------------------------------------------------------------
let specFiles;
try {
  specFiles = readdirSync(SPECS_DIR)
    .filter((f) => f.endsWith(".json") && !SPEC_SKIP.has(f))
    .sort();
} catch (err) {
  process.stderr.write(`[validate] Cannot read specs directory: ${SPECS_DIR}\n  ${err.message}\n`);
  process.exit(1);
}

if (specFiles.length === 0) {
  process.stderr.write(`[validate] No spec files found in ${SPECS_DIR}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate each spec
// ---------------------------------------------------------------------------
let specPassed = 0;
let specFailed = 0;

for (const file of specFiles) {
  const filePath = join(SPECS_DIR, file);
  let data;

  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    process.stderr.write(`[validate/spec] FAIL  ${file}\n  Parse error: ${err.message}\n`);
    specFailed++;
    continue;
  }

  const valid = validateSpec(data);

  if (valid) {
    process.stdout.write(`[validate/spec] PASS  ${file}\n`);
    specPassed++;
  } else {
    process.stderr.write(`[validate/spec] FAIL  ${file}\n`);
    for (const error of validateSpec.errors) {
      const field = error.instancePath || "(root)";
      process.stderr.write(`  ${field}: ${error.message}\n`);
    }
    specFailed++;
  }
}

// ── Label validation ─────────────────────────────────────────────────────────

const LABEL_SCHEMA_PATH = resolve(__dirname, "schemas/label.schema.json");
const LABELS_DIR = resolve(__dirname, "../../data/labels");

// Files that are not label records and should be skipped.
const LABEL_SKIP = new Set(["index.json"]);

// ---------------------------------------------------------------------------
// Load label schema
// ---------------------------------------------------------------------------
let labelSchema;
try {
  labelSchema = JSON.parse(readFileSync(LABEL_SCHEMA_PATH, "utf8"));
} catch (err) {
  process.stderr.write(`[validate/label] Cannot read label schema: ${LABEL_SCHEMA_PATH}\n  ${err.message}\n`);
  process.exit(1);
}

const validateLabel = ajv.compile(labelSchema);

// ---------------------------------------------------------------------------
// Discover label files
// ---------------------------------------------------------------------------
let labelFiles;
try {
  labelFiles = readdirSync(LABELS_DIR)
    .filter((f) => f.endsWith(".json") && !LABEL_SKIP.has(f))
    .sort();
} catch (err) {
  process.stderr.write(`[validate/label] Cannot read labels directory: ${LABELS_DIR}\n  ${err.message}\n`);
  process.exit(1);
}

if (labelFiles.length === 0) {
  process.stderr.write(`[validate/label] No label files found in ${LABELS_DIR}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Validate each label
// ---------------------------------------------------------------------------
let labelPassed = 0;
let labelFailed = 0;

for (const file of labelFiles) {
  const filePath = join(LABELS_DIR, file);
  let data;

  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (err) {
    process.stderr.write(`[validate/label] FAIL  ${file}\n  Parse error: ${err.message}\n`);
    labelFailed++;
    continue;
  }

  const valid = validateLabel(data);

  if (valid) {
    // Extra check: at least one verifiable source URL (CI requirement)
    if (!Array.isArray(data.sources) || data.sources.length === 0) {
      process.stderr.write(`[validate/label] FAIL  ${file}\n  sources: must have at least one verifiable source URL\n`);
      labelFailed++;
      continue;
    }

    process.stdout.write(`[validate/label] PASS  ${file}\n`);
    labelPassed++;
  } else {
    process.stderr.write(`[validate/label] FAIL  ${file}\n`);
    for (const error of validateLabel.errors) {
      const field = error.instancePath || "(root)";
      process.stderr.write(`  ${field}: ${error.message}\n`);
    }
    labelFailed++;
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const totalPassed = specPassed + labelPassed;
const totalFailed = specFailed + labelFailed;

process.stdout.write(`\n[validate] ${specPassed}/${specFiles.length} specs passed, ${labelPassed}/${labelFiles.length} labels passed (${totalPassed} passed, ${totalFailed} failed overall)\n`);

if (totalFailed > 0) {
  process.exit(1);
}
