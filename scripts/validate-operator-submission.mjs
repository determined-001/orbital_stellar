#!/usr/bin/env node
/**
 * Validate an operator submission before it is merged into the worker
 * registry.
 *
 * This is the automated gate for the operator onboarding flow (issue #1057).
 * It mirrors the semantic-layer submission validation (#911) and reuses the
 * same `validateOperatorRecord` / `validateWorkerOfferingRecord` functions
 * from `@orbital-stellar/abi-registry` where the shapes match.
 *
 * A submission is a directory containing:
 *   - `operator.json`   — an OperatorRecord
 *   - `offering.json`   — a WorkerOfferingRecord (optional)
 *   - `proof.json`      — key-ownership proof (signature over the operator
 *                         record by the claimed `stellarAddress`)
 *
 * The key-ownership proof is the one check that must NOT be skipped: without
 * it anyone can register an offering under someone else's identity and harvest
 * their reputation.
 *
 * Usage:
 *   node scripts/validate-operator-submission.mjs <submission-dir>
 *
 * Exit codes:
 *   0 — submission is well-formed and passes all automated checks
 *   1 — submission failed one or more checks (reasons printed to stderr)
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

import {
  validateOperatorRecord,
  validateWorkerOfferingRecord,
} from "@orbital-stellar/abi-registry";

const ACCOUNT_ID_RE = /^G[0-9A-Z]{55}$/;
const CONTRACT_ID_RE = /^C[0-9A-Z]{55}$/;

function fail(reasons) {
  for (const reason of reasons) {
    console.error(`  ✗ ${reason}`);
  }
  console.error("\nSubmission rejected. Fix the reasons above and resubmit.");
  process.exit(1);
}

function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    fail([`${file}: not valid JSON (${err.message})`]);
  }
}

/**
 * Verify that the claimed `stellarAddress` controls the key by checking a
 * signature over the canonical operator record.
 *
 * The proof file must contain:
 *   {
 *     "stellarAddress": "G...",
 *     "message": "<sha256 hex of the canonical operator record>",
 *     "signature": "<hex-encoded Ed25519 signature>"
 *   }
 *
 * Because this repository does not ship a Stellar SDK dependency for the
 * validation script, the signature is verified against the public key derived
 * from the claimed address using the `@stellar/stellar-sdk` package when
 * available. If the SDK is not installed the check fails closed (never skips).
 */
function verifyKeyOwnership(operator, proof) {
  if (!proof) {
    return ["proof.json is required: key-ownership proof must not be skipped"];
  }
  if (typeof proof.stellarAddress !== "string" || !ACCOUNT_ID_RE.test(proof.stellarAddress)) {
    return ["proof.json.stellarAddress: must be a G-prefixed 56-character Stellar strkey"];
  }
  if (proof.stellarAddress !== operator.stellarAddress) {
    return [
      `proof.json.stellarAddress (${proof.stellarAddress}) does not match ` +
        `operator.json.stellarAddress (${operator.stellarAddress})`,
    ];
  }
  if (typeof proof.message !== "string" || !/^[0-9a-f]{64}$/.test(proof.message)) {
    return ["proof.json.message: must be a 64-char hex sha256 digest"];
  }

  // The message must be the sha256 of the canonical operator record.
  const canonical = JSON.stringify(operator);
  const digest = createHash("sha256").update(canonical).digest("hex");
  if (proof.message !== digest) {
    return [
      "proof.json.message does not match the sha256 of operator.json — " +
        "sign the exact operator record you are submitting",
    ];
  }

  if (typeof proof.signature !== "string" || proof.signature.length === 0) {
    return ["proof.json.signature: must be a non-empty hex-encoded signature"];
  }

  // Verify the Ed25519 signature against the public key of the claimed address.
  let StellarSdk;
  try {
    StellarSdk = await import("@stellar/stellar-sdk");
  } catch {
    return [
      "proof.json.signature: cannot verify — @stellar/stellar-sdk is not installed. " +
        "Install it to verify key ownership; the check must not be skipped.",
    ];
  }

  try {
    const keypair = StellarSdk.Keypair.fromPublicKey(proof.stellarAddress);
    const verified = keypair.verify(
      Buffer.from(proof.message, "hex"),
      Buffer.from(proof.signature, "hex"),
    );
    if (!verified) {
      return ["proof.json.signature: signature does not verify against the claimed address"];
    }
  } catch (err) {
    return [`proof.json.signature: verification failed (${err.message})`];
  }

  return [];
}

/**
 * Check that every target contract referenced by an offering resolves in the
 * registry (i.e. appears in the well-known specs index or the labels index).
 */
function contractsResolve(offering, wellKnown, labels) {
  if (!offering) return [];
  const known = new Set([
    ...(wellKnown?.specs ?? []).map((s) => s.contract_id),
    ...(labels?.labels ?? []).map((l) => l.contractId),
  ]);
  if (!known.has(offering.contractId)) {
    return [
      `offering.json.contractId (${offering.contractId}) does not resolve in the ` +
        "registry — the target contract must already be registered",
    ];
  }
  return [];
}

function main() {
  const dir = resolve(process.argv[2] ?? ".");
  const reasons = [];

  const operator = readJson(join(dir, "operator.json"));
  const offering = readJson(join(dir, "offering.json"));
  const proof = readJson(join(dir, "proof.json"));

  if (!operator) {
    fail(["operator.json is required"]);
  }

  // 1. Schema-valid operator record.
  const opResult = validateOperatorRecord(operator);
  if (!opResult.valid) {
    reasons.push(...opResult.errors.map((e) => `operator.json: ${e}`));
  }

  // 2. Key-ownership proof (must not be skipped).
  reasons.push(...verifyKeyOwnership(operator, proof));

  // 3. Schema-valid offering (if present).
  if (offering) {
    const offResult = validateWorkerOfferingRecord(offering);
    if (!offResult.valid) {
      reasons.push(...offResult.errors.map((e) => `offering.json: ${e}`));
    }
    if (offering.operatorId !== operator.id) {
      reasons.push(
        `offering.json.operatorId (${offering.operatorId}) does not match ` +
          `operator.json.id (${operator.id})`,
      );
    }
  }

  // 4. Target contracts resolve in the registry.
  const wellKnown = readJson(
    join(dir, "..", "..", "packages", "abi-registry", "specs", "well-known", "index.json"),
  );
  const labels = readJson(join(dir, "..", "..", "data", "labels", "index.json"));
  reasons.push(...contractsResolve(offering, wellKnown, labels));

  if (reasons.length > 0) {
    fail(reasons);
  }

  console.log("✓ operator submission is well-formed and passes all automated checks.");
  console.log("  (schema-valid, key ownership proven, target contracts resolve)");
  process.exit(0);
}

main();
