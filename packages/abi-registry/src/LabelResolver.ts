/**
 * Entity Label Resolver for the Orbital ABI Registry.
 *
 * Labels attach human-readable identity to opaque contract addresses — making
 * event streams like `transfer(GB..., GC..., 1000000)` readable as
 * `transfer(Circle→Alice, 1000000)`.
 *
 * Labels are **advisory metadata**, never load-bearing for correctness.
 * Every consumer that reads labels must gate the resolution behind an opt-in
 * flag (`enableLabels: true`).
 *
 * ## Data layout
 *
 * Labels live as one JSON file per entity under `data/labels/` at the repo
 * root. Each file conforms to `packages/abi-registry/schemas/label.schema.json`.
 *
 * ```
 * data/labels/
 * ├── circle-usdc.json
 * ├── circle-eurc.json
 * ├── aqua.json
 * ├── soroswap-router.json
 * └── phoenix-pool-factory.json
 * ```
 *
 * ## Usage
 *
 * ```ts
 * const resolver = new LabelResolver({ enabled: true });
 *
 * // Resolve a single contract ID
 * const label = resolver.resolve(
 *   "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
 * );
 * // → { label: "Circle (USDC Issuer)", entityType: "issuer", ... }
 * ```
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Classification of what a labeled address represents.
 * - `protocol`: a smart-contract protocol (DEX, lending market, etc.)
 * - `issuer`: a token issuer (Circle, Aquarius DAO, etc.)
 * - `deployer`: the account that deployed the contract
 * - `bridge`: a cross-chain bridge contract
 * - `unknown`: type not yet determined
 */
export type EntityType = "protocol" | "issuer" | "deployer" | "bridge" | "unknown";

/**
 * A single entity label record, conforming to `label.schema.json`.
 */
export type LabelRecord = {
  /** Schema revision this record conforms to, in MAJOR.MINOR.PATCH semver. */
  schemaVersion: string;
  /** Canonical mainnet Soroban contract address (C-prefixed strkey). */
  contractId: string;
  /** Human-readable entity name (e.g. "Circle", "Soroswap Router"). */
  label: string;
  /** Classification of what the labeled address represents. */
  entityType: EntityType;
  /** Certainty between 0.0 (none) and 1.0 (verified). */
  confidence: number;
  /** Verifiable source URLs supporting this attribution. */
  sources: string[];
  /** ISO 8601 UTC timestamp of last verification. */
  verifiedAt: string;
  /** GitHub username or entity identifier that submitted this record. */
  submittedBy: string;
  /** Optional reference to a parent label record. */
  parentContractId?: string;
  /** Optional free-text notes providing context. */
  notes?: string;
};

/**
 * Configuration for the label resolver.
 */
export type LabelResolverConfig = {
  /**
   * Whether label resolution is enabled. When `false`, all label operations
   * silently return `null` — labels are **advisory** and never load-bearing
   * for correctness.
   *
   * @default false
   */
  enabled: boolean;
};

/**
 * Resolved label attached to a decoded event or contract address.
 */
export type ResolvedLabel = {
  /** The human-readable label (e.g. "Circle"). */
  label: string;
  /** Entity classification type. */
  entityType: EntityType;
  /** Confidence of this attribution (0.0–1.0). */
  confidence: number;
};

// ---------------------------------------------------------------------------
// Label directory resolution
// ---------------------------------------------------------------------------

/** Absolute path to `data/labels/` relative to the repo root. */
function labelsDir(): string {
  // Navigate up from `packages/abi-registry/src/LabelResolver.ts` to repo root.
  const currentDir = dirname(fileURLToPath(import.meta.url));
  // From `packages/abi-registry/src/` -> `packages/abi-registry/` -> `packages/` -> repo root
  const repoRoot = resolve(currentDir, "../../..");
  return resolve(repoRoot, "data/labels");
}

/** File names in `data/labels/` to load (excludes JSON that aren't label records). */
const LABEL_FILES = [
  "circle-usdc.json",
  "circle-eurc.json",
  "aqua.json",
  "xlm-native.json",
  "soroswap-router.json",
  "phoenix-pool-factory.json",
];

// ---------------------------------------------------------------------------
// Lazy-loaded bundle
// ---------------------------------------------------------------------------

let cachedByContractId: Map<string, LabelRecord> | null = null;

/**
 * Load all label records from `data/labels/` into a contractId → LabelRecord map.
 * Uses module-level lazy caching so repeated resolutions across instances
 * avoid re-reading disk.
 */
function loadLabels(): Map<string, LabelRecord> {
  if (cachedByContractId) return cachedByContractId;

  const dir = labelsDir();
  const map = new Map<string, LabelRecord>();

  for (const file of LABEL_FILES) {
    try {
      const raw = JSON.parse(readFileSync(resolve(dir, file), "utf-8")) as LabelRecord;
      if (raw.contractId) {
        map.set(raw.contractId, raw);
      }
    } catch {
      // Silently skip unreadable or malformed label files — labels are
      // advisory and a broken file should never crash the consumer.
    }
  }

  cachedByContractId = map;
  return map;
}

// ---------------------------------------------------------------------------
// Resolver class
// ---------------------------------------------------------------------------

/**
 * Resolves human-readable entity labels for Soroban contract addresses.
 *
 * Labels are loaded from the bundled `data/labels/` directory and are purely
 * advisory — they must never be used for correctness-critical logic. All
 * label resolution is gated behind an explicit `enabled` flag.
 *
 * @example
 * ```ts
 * const resolver = new LabelResolver({ enabled: true });
 *
 * // Resolve a single contract ID
 * const label = resolver.resolve("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75");
 * // → { label: "Circle (USDC Issuer)", entityType: "issuer", confidence: 1.0 }
 *
 * // Batch resolution
 * const labels = resolver.resolveAll([usdcId, aquaId, unknownId]);
 * // → Map { usdcId => { ... }, aquaId => { ... } }
 * ```
 */
export class LabelResolver {
  private readonly enabled: boolean;

  constructor(config?: LabelResolverConfig) {
    this.enabled = config?.enabled ?? false;
  }

  /**
   * Resolve the label for a single contract address.
   *
   * @param contractId - The C-prefixed Soroban contract address.
   * @returns A resolved label, or `null` if the resolver is disabled or the
   *   address has no known label.
   */
  resolve(contractId: string): ResolvedLabel | null {
    if (!this.enabled) return null;

    const labels = loadLabels();
    const record = labels.get(contractId);
    if (!record) return null;

    return {
      label: record.label,
      entityType: record.entityType,
      confidence: record.confidence,
    };
  }

  /**
   * Resolve labels for multiple contract addresses in a single call.
   *
   * @param contractIds - Array of C-prefixed Soroban contract addresses.
   * @returns A map of contract ID → resolved label (only entries with known
   *   labels are included).
   */
  resolveAll(contractIds: string[]): Map<string, ResolvedLabel> {
    const result = new Map<string, ResolvedLabel>();

    if (!this.enabled) return result;

    const labels = loadLabels();
    for (const id of contractIds) {
      const record = labels.get(id);
      if (record) {
        result.set(id, {
          label: record.label,
          entityType: record.entityType,
          confidence: record.confidence,
        });
      }
    }

    return result;
  }
}
