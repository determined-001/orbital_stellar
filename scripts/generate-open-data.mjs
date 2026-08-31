import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const dataDir = path.join(rootDir, "data");
const webPublicDataDir = path.join(rootDir, "apps/web/public/data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(webPublicDataDir)) {
  fs.mkdirSync(webPublicDataDir, { recursive: true });
}

let generatedAt = new Date().toISOString();
const SCHEMA_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// 1. Build Taxonomy Records
// ---------------------------------------------------------------------------

const classicTaxonomy = [
  {
    id: "payment.received",
    name: "Payment Received",
    type: "classic",
    category: "payments",
    eventType: "payment.received",
    description: "Normalized asset payment received by an account.",
    source: "horizon",
  },
  {
    id: "payment.sent",
    name: "Payment Sent",
    type: "classic",
    category: "payments",
    eventType: "payment.sent",
    description: "Normalized asset payment sent by an account.",
    source: "horizon",
  },
  {
    id: "payment.self",
    name: "Self Payment",
    type: "classic",
    category: "payments",
    eventType: "payment.self",
    description: "Normalized payment where source and destination accounts are identical.",
    source: "horizon",
  },
  {
    id: "account.created",
    name: "Account Created",
    type: "classic",
    category: "account",
    eventType: "account.created",
    description: "Creation of a new Stellar account with starting XLM balance.",
    source: "horizon",
  },
  {
    id: "account.options_changed",
    name: "Account Options Changed",
    type: "classic",
    category: "account",
    eventType: "account.options_changed",
    description: "Updates to account thresholds, home domain, or multi-signature signers.",
    source: "horizon",
  },
  {
    id: "account.merged",
    name: "Account Merged",
    type: "classic",
    category: "account",
    eventType: "account.merged",
    description: "Account merged into a destination account, transferring remaining XLM balance.",
    source: "horizon",
  },
  {
    id: "account.bump_sequence",
    name: "Bump Sequence",
    type: "classic",
    category: "account",
    eventType: "account.bump_sequence",
    description: "Account sequence number advanced forward.",
    source: "horizon",
  },
  {
    id: "trustline.added",
    name: "Trustline Added",
    type: "classic",
    category: "trustline",
    eventType: "trustline.added",
    description: "New asset trustline established for an account.",
    source: "horizon",
  },
  {
    id: "trustline.removed",
    name: "Trustline Removed",
    type: "classic",
    category: "trustline",
    eventType: "trustline.removed",
    description: "Existing trustline removed from an account.",
    source: "horizon",
  },
  {
    id: "trustline.updated",
    name: "Trustline Updated",
    type: "classic",
    category: "trustline",
    eventType: "trustline.updated",
    description: "Trustline limit updated for an asset.",
    source: "horizon",
  },
  {
    id: "trustline.authorized",
    name: "Trustline Authorized",
    type: "classic",
    category: "trustline",
    eventType: "trustline.authorized",
    description: "Issuer authorization granted for a trustline.",
    source: "horizon",
  },
  {
    id: "trustline.deauthorized",
    name: "Trustline Deauthorized",
    type: "classic",
    category: "trustline",
    eventType: "trustline.deauthorized",
    description: "Issuer authorization revoked for a trustline.",
    source: "horizon",
  },
  {
    id: "offer.created",
    name: "DEX Offer Created",
    type: "classic",
    category: "dex",
    eventType: "offer.created",
    description: "New order created on the Stellar decentralized exchange.",
    source: "horizon",
  },
  {
    id: "offer.updated",
    name: "DEX Offer Updated",
    type: "classic",
    category: "dex",
    eventType: "offer.updated",
    description: "Existing order modified on the Stellar decentralized exchange.",
    source: "horizon",
  },
  {
    id: "offer.deleted",
    name: "DEX Offer Deleted",
    type: "classic",
    category: "dex",
    eventType: "offer.deleted",
    description: "Order canceled or fully filled on the Stellar decentralized exchange.",
    source: "horizon",
  },
  {
    id: "claimable.created",
    name: "Claimable Balance Created",
    type: "classic",
    category: "claimable",
    eventType: "claimable.created",
    description: "New claimable balance sponsored and created.",
    source: "horizon",
  },
  {
    id: "claimable.claimed",
    name: "Claimable Balance Claimed",
    type: "classic",
    category: "claimable",
    eventType: "claimable.claimed",
    description: "Claimable balance claimed by an eligible destination.",
    source: "horizon",
  },
  {
    id: "lp.deposited",
    name: "Liquidity Pool Deposited",
    type: "classic",
    category: "liquidity_pool",
    eventType: "lp.deposited",
    description: "Reserves deposited into a constant-product liquidity pool in exchange for pool shares.",
    source: "horizon",
  },
  {
    id: "lp.withdrawn",
    name: "Liquidity Pool Withdrawn",
    type: "classic",
    category: "liquidity_pool",
    eventType: "lp.withdrawn",
    description: "Pool shares redeemed to withdraw underlying liquidity pool reserves.",
    source: "horizon",
  },
  {
    id: "data.set",
    name: "Account Data Set",
    type: "classic",
    category: "data",
    eventType: "data.set",
    description: "Key-value pair set on account storage.",
    source: "horizon",
  },
  {
    id: "data.cleared",
    name: "Account Data Cleared",
    type: "classic",
    category: "data",
    eventType: "data.cleared",
    description: "Key-value pair removed from account storage.",
    source: "horizon",
  },
  // CAP-67 unified-stream events. These arrive on the Stellar RPC unified
  // event stream rather than Horizon, so they carry `source: "soroban-rpc"`
  // even though the underlying movements are classic.
  {
    id: "asset.clawback",
    name: "Asset Clawback",
    type: "classic",
    category: "assets",
    eventType: "asset.clawback",
    description: "Issuer clawed back a clawback-enabled asset from an account.",
    source: "soroban-rpc",
  },
  {
    id: "fee.incurred",
    name: "Fee Incurred",
    type: "classic",
    category: "fees",
    eventType: "fee.incurred",
    description:
      "Network fee charged for a classic transaction, emitted as a discrete event by CAP-67. No Horizon-derived equivalent exists.",
    source: "soroban-rpc",
  },
  {
    id: "contract.invoked",
    name: "Soroban Contract Invoked",
    type: "soroban",
    category: "soroban",
    eventType: "contract.invoked",
    description: "Soroban smart contract function invocation event.",
    source: "soroban-rpc",
  },
  {
    id: "contract.emitted",
    name: "Soroban Event Emitted",
    type: "soroban",
    category: "soroban",
    eventType: "contract.emitted",
    description: "Soroban smart contract topic-based event emission.",
    source: "soroban-rpc",
  },
  {
    id: "anchor.transaction_status_changed",
    name: "Anchor Transaction Status Changed",
    type: "anchor",
    category: "anchor",
    eventType: "anchor.transaction_status_changed",
    description:
      "SEP-24 or SEP-31 anchor transaction moved to a new status; the protocol-specific status is preserved alongside the normalized one.",
    source: "anchor-sdk",
  },
];

// Enrich taxonomy with well-known contract events from packages/abi-registry/specs/well-known
const wellKnownIndexFile = path.join(rootDir, "packages/abi-registry/specs/well-known/index.json");
const wellKnownSpecsDir = path.join(rootDir, "packages/abi-registry/specs/well-known");

let sorobanContractEventTaxonomy = [];
if (fs.existsSync(wellKnownIndexFile)) {
  const indexContent = JSON.parse(fs.readFileSync(wellKnownIndexFile, "utf-8"));
  const seenEvents = new Set();

  for (const entry of indexContent.specs || []) {
    const specFilePath = path.join(wellKnownSpecsDir, entry.file);
    if (fs.existsSync(specFilePath)) {
      const spec = JSON.parse(fs.readFileSync(specFilePath, "utf-8"));
      for (const ev of spec.events || []) {
        const key = `${entry.file}:${ev.name}`;
        if (!seenEvents.has(key)) {
          seenEvents.add(key);
          sorobanContractEventTaxonomy.push({
            id: `soroban.${ev.name}`,
            name: `Soroban ${ev.name} Event`,
            type: "soroban",
            category: entry.tags?.[0] || "soroban",
            eventType: "contract.emitted",
            eventName: ev.name,
            contract: entry.name,
            contractId: spec.contract_id,
            description: ev.doc || `${ev.name} event emitted by ${entry.name}`,
            topics: (ev.topics || []).map((t) => t.name),
            data: (ev.data || []).map((d) => d.name),
            source: "soroban-rpc",
          });
        }
      }
    }
  }
}

const taxonomyRecords = [...classicTaxonomy, ...sorobanContractEventTaxonomy];

const taxonomyData = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  recordCount: taxonomyRecords.length,
  records: taxonomyRecords,
};

// ---------------------------------------------------------------------------
// 2. Build Label Records
// ---------------------------------------------------------------------------

let labelRecords = [];
if (fs.existsSync(wellKnownIndexFile)) {
  const indexContent = JSON.parse(fs.readFileSync(wellKnownIndexFile, "utf-8"));
  for (const entry of indexContent.specs || []) {
    const specFilePath = path.join(wellKnownSpecsDir, entry.file);
    let network = "mainnet";
    if (fs.existsSync(specFilePath)) {
      const spec = JSON.parse(fs.readFileSync(specFilePath, "utf-8"));
      if (spec.network) network = spec.network;
    }
    labelRecords.push({
      contractId: entry.contract_id,
      name: entry.name,
      description: entry.description,
      network: network,
      tags: entry.tags || [],
      category: entry.tags?.[2] || entry.tags?.[0] || "contract",
      verified: true,
      specFile: entry.file,
    });
  }
}

const labelsData = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  recordCount: labelRecords.length,
  records: labelRecords,
};

// Keep the manifest deterministic: `generatedAt` is bumped only when the
// regenerated *content* actually changes. If the records are byte-identical
// to what is already committed (ignoring the timestamp), reuse the committed
// `generatedAt` so a regeneration with no real drift produces a byte-identical
// snapshot. This is what lets CI regenerate and fail on `git diff --exit-code`
// without a false positive on every run.
function existingGeneratedAt(file) {
  try {
    const existing = JSON.parse(fs.readFileSync(file, "utf-8"));
    return typeof existing.generatedAt === "string" ? existing.generatedAt : null;
  } catch {
    return null;
  }
}

function recordsMatch(candidate, existingFile) {
  try {
    const existing = JSON.parse(fs.readFileSync(existingFile, "utf-8"));
    return JSON.stringify(existing.records) === JSON.stringify(candidate.records);
  } catch {
    return false;
  }
}

const previousGeneratedAt = existingGeneratedAt(path.join(dataDir, "integrity.json"));
const taxonomyChanged = !recordsMatch(taxonomyData, path.join(dataDir, "taxonomy.json"));
const labelsChanged = !recordsMatch(labelsData, path.join(dataDir, "labels.json"));

if (!taxonomyChanged && !labelsChanged && previousGeneratedAt) {
  generatedAt = previousGeneratedAt;
  // The record objects above were constructed with the "now" value; align them
  // so the emitted files carry the deterministic timestamp too.
  taxonomyData.generatedAt = generatedAt;
  labelsData.generatedAt = generatedAt;
}

// Write taxonomy.json & labels.json to data/ and apps/web/public/data/
const taxonomyJsonStr = JSON.stringify(taxonomyData, null, 2) + "\n";
const labelsJsonStr = JSON.stringify(labelsData, null, 2) + "\n";

fs.writeFileSync(path.join(dataDir, "taxonomy.json"), taxonomyJsonStr);
fs.writeFileSync(path.join(webPublicDataDir, "taxonomy.json"), taxonomyJsonStr);

fs.writeFileSync(path.join(dataDir, "labels.json"), labelsJsonStr);
fs.writeFileSync(path.join(webPublicDataDir, "labels.json"), labelsJsonStr);

// Copy LICENSE if present
const rootLicense = path.join(dataDir, "LICENSE");
if (fs.existsSync(rootLicense)) {
  const licenseStr = fs.readFileSync(rootLicense, "utf-8");
  fs.writeFileSync(path.join(webPublicDataDir, "LICENSE"), licenseStr);
}

// ---------------------------------------------------------------------------
// 3. Build Integrity Manifest
// ---------------------------------------------------------------------------

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

const licenseContent = fs.existsSync(rootLicense) ? fs.readFileSync(rootLicense, "utf-8") : "";

const integrityData = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt,
  files: {
    "taxonomy.json": {
      sha256: sha256(taxonomyJsonStr),
      bytes: Buffer.byteLength(taxonomyJsonStr, "utf-8"),
      recordCount: taxonomyRecords.length,
    },
    "labels.json": {
      sha256: sha256(labelsJsonStr),
      bytes: Buffer.byteLength(labelsJsonStr, "utf-8"),
      recordCount: labelRecords.length,
    },
    "LICENSE": {
      sha256: sha256(licenseContent),
      bytes: Buffer.byteLength(licenseContent, "utf-8"),
      license: "CC0-1.0",
    },
  },
};

const integrityJsonStr = JSON.stringify(integrityData, null, 2) + "\n";

fs.writeFileSync(path.join(dataDir, "integrity.json"), integrityJsonStr);
fs.writeFileSync(path.join(webPublicDataDir, "integrity.json"), integrityJsonStr);

console.log(`Open data artifacts generated successfully:`);
console.log(`  - taxonomy.json: ${taxonomyRecords.length} records`);
console.log(`  - labels.json: ${labelRecords.length} records`);
console.log(`  - integrity.json: SHA-256 digests computed`);
