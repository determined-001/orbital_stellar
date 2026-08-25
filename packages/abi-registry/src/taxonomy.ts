/**
 * Semantic taxonomy entries: the machine-readable format community submissions
 * conform to when they map a contract's raw event topics onto a human-readable
 * taxonomy name (`swap.executed`, `payment.sent`, `loan.liquidated`).
 *
 * A taxonomy entry answers four questions, and nothing else:
 *
 * 1. **Which raw events does this apply to?** - `match`, a topic pattern.
 * 2. **Which contracts does this apply to?** - `scope`: specific contract IDs,
 *    specific WASM hashes, or every contract implementing a SEP interface.
 * 3. **What is the event called, semantically?** - `name`, dot-namespaced.
 * 4. **Where do the taxonomy's parameters come from?** - `parameters`, each
 *    projected out of a topic slot or the data payload.
 *
 * Plus `provenance`: who submitted it, when, and what they based it on. The
 * data is published as open data, so a claim with no traceable source is not
 * reviewable.
 *
 * The JSON Schema at `schema/taxonomy.schema.json` is the normative artifact -
 * it is what a submission is validated against in review. Everything here is
 * the TypeScript mirror of it, plus {@link validateTaxonomyEntry} for callers
 * who want the same check without pulling in a JSON Schema validator, and
 * {@link findTaxonomyConflicts} for the collision policy.
 */

import type { PrimitiveType, ValidationResult } from "./spec.js";

// ── Naming rules ──────────────────────────────────────────────────────────────

/**
 * The namespace roots a taxonomy name may use - the first dot-separated
 * segment. Deliberately a closed list: an open-ended root would let two
 * submissions describe the same concept under different names
 * (`swap.executed` vs `dex.swapped`), which is exactly what a shared taxonomy
 * exists to prevent. Adding a root is a schema change, reviewed once, rather
 * than a per-submission decision.
 *
 * `account`/`asset`/`claimable`/`contract`/`data`/`lp`/`offer`/`payment`/
 * `trustline` already carry meaning in `@orbital-stellar/pulse-core`'s
 * `NormalizedEvent` taxonomy; a contract-event mapping that means the same
 * thing should reuse the established name rather than mint a parallel one.
 * The rest are the contract-level concepts the semantic layer exists to cover.
 */
export const TAXONOMY_NAMESPACE_ROOTS = [
  "account",
  "asset",
  "bridge",
  "claimable",
  "contract",
  "data",
  "governance",
  "loan",
  "lp",
  "nft",
  "offer",
  "oracle",
  "payment",
  "stake",
  "swap",
  "trustline",
  "vault",
] as const;

/** A permitted first segment of a taxonomy name. See {@link TAXONOMY_NAMESPACE_ROOTS}. */
export type TaxonomyNamespaceRoot = (typeof TAXONOMY_NAMESPACE_ROOTS)[number];

/**
 * Roots that are permanently unavailable to taxonomy entries. `engine.*` and
 * `event.*` are `pulse-core`'s own library diagnostics (`engine.reconnecting`,
 * `event.decode_failed`) - they describe the indexer, not the chain, so a
 * community entry must never be able to claim one and have consumers confuse
 * an on-chain event with a client-side notification.
 */
export const RESERVED_TAXONOMY_NAMESPACE_ROOTS = ["engine", "event"] as const;

/**
 * Casing and shape rules for a taxonomy name:
 *
 * - Two or three dot-separated segments: `<root>.<action>` or
 *   `<root>.<subject>.<action>`. One segment carries no information; four is
 *   a sign the concept belongs under a different root.
 * - Lowercase ASCII `snake_case` within a segment, starting with a letter.
 * - The first segment must be in {@link TAXONOMY_NAMESPACE_ROOTS}.
 * - The action segment is a past-tense verb (`executed`, `liquidated`,
 *   `deposited`) - a taxonomy name names something that happened. This is a
 *   review convention, not enforced here, since tense is not decidable from
 *   the string.
 */
export const TAXONOMY_NAME_RE = new RegExp(
  `^(${TAXONOMY_NAMESPACE_ROOTS.join("|")})\\.[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)?$`,
);

// ── Entry shape ───────────────────────────────────────────────────────────────

/** Network a scope is restricted to. Same set as `ContractSpec.network`. */
export type TaxonomyNetwork = "mainnet" | "testnet" | "futurenet";

/**
 * One slot in a raw event's topic vector.
 *
 * Matchers decide *whether* an entry applies to an event; they never extract
 * values. Extraction is {@link ParameterMapping}'s job, keyed by topic index -
 * keeping the two separate means a pattern can be tightened without silently
 * re-binding a parameter.
 */
export type TopicMatcher =
  /** The topic must be exactly this symbol - conventionally slot 0, the event name. */
  | { readonly kind: "symbol"; readonly symbol: string }
  /** Any single topic, optionally constrained to one Soroban scalar type. */
  | { readonly kind: "any"; readonly type?: PrimitiveType; readonly doc?: string };

/** The raw-event pattern an entry applies to. */
export type TaxonomyMatch = {
  /** Topic matchers, positional from slot 0. */
  readonly topics: ReadonlyArray<TopicMatcher>;
  /**
   * Whether topics beyond `topics.length` are tolerated. Defaults to
   * `"forbidden"` - a stricter pattern is the safer default for a mapping
   * that consumers will trust. `"allowed"` is the right choice for SEP-41
   * events on Stellar Asset Contracts, where CAP-67 appends an `asset` topic
   * that a contract-token event does not have.
   */
  readonly trailingTopics?: "forbidden" | "allowed";
  /**
   * Optional constraint on the data payload's shape. `"scalar"` covers a
   * single value (SEP-41's `i128` amount), `"map"` covers CAP-67-style
   * keyed data. Omitted means unconstrained.
   */
  readonly dataShape?: "void" | "scalar" | "map" | "vec";
};

/**
 * Where one taxonomy parameter's value comes from in the raw event.
 */
export type ParameterMapping =
  /** A topic slot, by index into the raw topic vector. */
  | {
      readonly from: "topic";
      readonly index: number;
      readonly type: PrimitiveType;
      readonly doc?: string;
    }
  /**
   * The data payload. `path` selects a key for map-shaped data (dotted for
   * nesting); omit it to take the whole data value, as SEP-41's bare `i128`
   * amount requires.
   */
  | {
      readonly from: "data";
      readonly path?: string;
      readonly type: PrimitiveType;
      readonly doc?: string;
    }
  /**
   * A fixed value the raw event does not carry. This is how one raw event maps
   * onto a taxonomy name that is more specific than the event itself - e.g.
   * `direction: "out"` distinguishing the sender's view of a transfer.
   */
  | { readonly from: "constant"; readonly value: string | number | boolean; readonly doc?: string };

/**
 * Which deployed contracts an entry applies to.
 *
 * `contract` is narrowest and always safe. `wasmHash` covers every deployment
 * of one reviewed build, which is the honest scope for a protocol that deploys
 * the same code many times. `interface` is broadest - it applies to anything
 * implementing the named SEP - and should only be used for events the SEP
 * itself defines, never for a protocol's own extensions.
 */
export type TaxonomyScope =
  | {
      readonly kind: "contract";
      readonly contractIds: ReadonlyArray<string>;
      readonly networks?: ReadonlyArray<TaxonomyNetwork>;
    }
  | {
      readonly kind: "wasmHash";
      /** Hex-encoded SHA-256 WASM hashes, 64 lowercase hex chars each. */
      readonly wasmHashes: ReadonlyArray<string>;
      readonly networks?: ReadonlyArray<TaxonomyNetwork>;
    }
  | {
      readonly kind: "interface";
      /** SEP interface identifier, e.g. `"SEP-41"`. */
      readonly interface: string;
      readonly networks?: ReadonlyArray<TaxonomyNetwork>;
    };

/** Who submitted an entry, when, and on what basis. */
export type TaxonomyProvenance = {
  /** GitHub handle (`@octocat`) or Stellar account address (`G…`) of the submitter. */
  readonly submittedBy: string;
  /** ISO 8601 timestamp of submission. */
  readonly submittedAt: string;
  /**
   * At least one URL backing the claim: protocol docs, the contract's source,
   * an audit, or an explorer link to a real emitted event.
   */
  readonly sources: ReadonlyArray<string>;
  readonly reviewedBy?: ReadonlyArray<string>;
  readonly reviewedAt?: string;
};

/**
 * A single community-submittable taxonomy entry: "events matching this pattern,
 * from contracts in this scope, mean this."
 */
export type TaxonomyEntry = {
  /**
   * Stable slug identifying this entry, unique across the published set.
   * Referenced by {@link TaxonomyEntry.supersedes} and by review tooling, so it
   * must not change once published - rename by superseding, not by editing.
   */
  readonly id: string;
  /** Semantic version of this entry, bumped when `match` or `parameters` change. */
  readonly version: string;
  /** Dot-namespaced taxonomy name. See {@link TAXONOMY_NAME_RE}. */
  readonly name: string;
  /** Short human-readable label for UIs. */
  readonly title?: string;
  /** What the event means, in prose, for reviewers and consumers. */
  readonly description?: string;
  readonly match: TaxonomyMatch;
  /** Taxonomy parameters, keyed by `snake_case` parameter name. */
  readonly parameters?: Readonly<Record<string, ParameterMapping>>;
  readonly scope: TaxonomyScope;
  readonly provenance: TaxonomyProvenance;
  /**
   * IDs of entries this one replaces. Declaring a supersession is what makes an
   * otherwise-conflicting overlap legal - see {@link findTaxonomyConflicts}.
   */
  readonly supersedes?: ReadonlyArray<string>;
  /** Set once an entry is retired but kept published for historical decoding. */
  readonly deprecated?: boolean;
};

// ── Runtime validation ────────────────────────────────────────────────────────

const PRIMITIVE_TYPES: ReadonlySet<string> = new Set<PrimitiveType>([
  "bool",
  "u32",
  "i32",
  "u64",
  "i64",
  "u128",
  "i128",
  "u256",
  "i256",
  "bytes",
  "string",
  "symbol",
  "address",
  "void",
  "error",
]);

const NETWORKS: ReadonlySet<string> = new Set<TaxonomyNetwork>(["mainnet", "testnet", "futurenet"]);

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const CONTRACT_ID_RE = /^C[A-Z2-7]{55}$/;
const WASM_HASH_RE = /^[0-9a-f]{64}$/;
const INTERFACE_RE = /^SEP-\d{1,4}$/;
const PARAMETER_NAME_RE = /^[a-z][a-z0-9_]*$/;
const SYMBOL_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateTopicMatcher(m: unknown, path: string, errors: string[]): void {
  if (!isRecord(m)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  const kind = m["kind"];
  if (kind === "symbol") {
    if (typeof m["symbol"] !== "string" || !SYMBOL_RE.test(m["symbol"])) {
      errors.push(`${path}.symbol: must be a Soroban symbol`);
    }
    return;
  }
  if (kind === "any") {
    if (m["type"] !== undefined && !PRIMITIVE_TYPES.has(m["type"] as string)) {
      errors.push(`${path}.type: unknown primitive type ${JSON.stringify(m["type"])}`);
    }
    return;
  }
  errors.push(`${path}.kind: expected "symbol" or "any", got ${JSON.stringify(kind)}`);
}

function validateMatch(match: unknown, path: string, errors: string[]): void {
  if (!isRecord(match)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  const topics = match["topics"];
  if (!Array.isArray(topics) || topics.length === 0) {
    errors.push(`${path}.topics: must be a non-empty array`);
  } else {
    (topics as unknown[]).forEach((t, i) =>
      validateTopicMatcher(t, `${path}.topics[${i}]`, errors),
    );
  }
  const trailing = match["trailingTopics"];
  if (trailing !== undefined && trailing !== "forbidden" && trailing !== "allowed") {
    errors.push(`${path}.trailingTopics: must be "forbidden" or "allowed"`);
  }
  const dataShape = match["dataShape"];
  if (dataShape !== undefined && !["void", "scalar", "map", "vec"].includes(dataShape as string)) {
    errors.push(`${path}.dataShape: must be "void", "scalar", "map", or "vec"`);
  }
}

function validateParameterMapping(p: unknown, path: string, errors: string[]): void {
  if (!isRecord(p)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  const from = p["from"];
  switch (from) {
    case "topic": {
      const index = p["index"];
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
        errors.push(`${path}.index: must be a non-negative integer`);
      }
      if (!PRIMITIVE_TYPES.has(p["type"] as string)) {
        errors.push(`${path}.type: unknown primitive type ${JSON.stringify(p["type"])}`);
      }
      return;
    }
    case "data": {
      if (p["path"] !== undefined && (typeof p["path"] !== "string" || p["path"].length === 0)) {
        errors.push(`${path}.path: must be a non-empty string when present`);
      }
      if (!PRIMITIVE_TYPES.has(p["type"] as string)) {
        errors.push(`${path}.type: unknown primitive type ${JSON.stringify(p["type"])}`);
      }
      return;
    }
    case "constant": {
      const value = p["value"];
      if (!["string", "number", "boolean"].includes(typeof value)) {
        errors.push(`${path}.value: must be a string, number, or boolean`);
      }
      return;
    }
    default:
      errors.push(
        `${path}.from: expected "topic", "data", or "constant", got ${JSON.stringify(from)}`,
      );
  }
}

function validateNetworks(networks: unknown, path: string, errors: string[]): void {
  if (networks === undefined) return;
  if (!Array.isArray(networks) || networks.length === 0) {
    errors.push(`${path}: must be a non-empty array when present`);
    return;
  }
  (networks as unknown[]).forEach((n, i) => {
    if (!NETWORKS.has(n as string)) {
      errors.push(`${path}[${i}]: must be "mainnet", "testnet", or "futurenet"`);
    }
  });
}

function validateScope(scope: unknown, path: string, errors: string[]): void {
  if (!isRecord(scope)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  validateNetworks(scope["networks"], `${path}.networks`, errors);

  switch (scope["kind"]) {
    case "contract": {
      const ids = scope["contractIds"];
      if (!Array.isArray(ids) || ids.length === 0) {
        errors.push(`${path}.contractIds: must be a non-empty array`);
        return;
      }
      (ids as unknown[]).forEach((id, i) => {
        if (typeof id !== "string" || !CONTRACT_ID_RE.test(id)) {
          errors.push(
            `${path}.contractIds[${i}]: must be a C-prefixed 56-character Stellar strkey`,
          );
        }
      });
      return;
    }
    case "wasmHash": {
      const hashes = scope["wasmHashes"];
      if (!Array.isArray(hashes) || hashes.length === 0) {
        errors.push(`${path}.wasmHashes: must be a non-empty array`);
        return;
      }
      (hashes as unknown[]).forEach((h, i) => {
        if (typeof h !== "string" || !WASM_HASH_RE.test(h)) {
          errors.push(`${path}.wasmHashes[${i}]: must be 64 lowercase hex characters`);
        }
      });
      return;
    }
    case "interface": {
      const iface = scope["interface"];
      if (typeof iface !== "string" || !INTERFACE_RE.test(iface)) {
        errors.push(`${path}.interface: must be a SEP identifier, e.g. "SEP-41"`);
      }
      return;
    }
    default:
      errors.push(
        `${path}.kind: expected "contract", "wasmHash", or "interface", got ${JSON.stringify(scope["kind"])}`,
      );
  }
}

function validateProvenance(prov: unknown, path: string, errors: string[]): void {
  if (!isRecord(prov)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (typeof prov["submittedBy"] !== "string" || prov["submittedBy"].length === 0) {
    errors.push(`${path}.submittedBy: must be a non-empty string`);
  }
  if (typeof prov["submittedAt"] !== "string" || Number.isNaN(Date.parse(prov["submittedAt"]))) {
    errors.push(`${path}.submittedAt: must be an ISO 8601 timestamp`);
  }
  const sources = prov["sources"];
  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push(`${path}.sources: must list at least one source URL`);
  } else {
    (sources as unknown[]).forEach((s, i) => {
      if (typeof s !== "string" || !/^https?:\/\/\S+$/.test(s)) {
        errors.push(`${path}.sources[${i}]: must be an http(s) URL`);
      }
    });
  }
  if (prov["reviewedAt"] !== undefined && Number.isNaN(Date.parse(prov["reviewedAt"] as string))) {
    errors.push(`${path}.reviewedAt: must be an ISO 8601 timestamp when present`);
  }
}

/**
 * Validates an unknown value as a {@link TaxonomyEntry}, collecting every
 * problem rather than stopping at the first, so a submitter gets one complete
 * list of fixes.
 *
 * This is the same rule set as `schema/taxonomy.schema.json`, hand-written so
 * consumers of this package don't need a JSON Schema validator at runtime, and
 * held in step with it by tests rather than by generation. One deliberate
 * difference: the JSON Schema is `additionalProperties: false` everywhere,
 * while this ignores unknown properties - same as {@link validateSpec}. Review
 * gating should use the schema; runtime consumers should use this.
 *
 * @example
 * ```ts
 * const result = validateTaxonomyEntry(JSON.parse(submission));
 * if (!result.valid) {
 *   for (const error of result.errors) console.error(error);
 * }
 * ```
 */
export function validateTaxonomyEntry(entry: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isRecord(entry)) {
    return { valid: false, errors: ["root: TaxonomyEntry must be an object"] };
  }

  if (typeof entry["id"] !== "string" || !ID_RE.test(entry["id"])) {
    errors.push("id: must be a lowercase kebab-case slug");
  }
  if (typeof entry["version"] !== "string" || !SEMVER_RE.test(entry["version"])) {
    errors.push('version: must be a semver string (e.g. "1.0.0")');
  }
  if (typeof entry["name"] !== "string" || !TAXONOMY_NAME_RE.test(entry["name"])) {
    errors.push(
      `name: must be a dot-namespaced taxonomy name rooted in one of ${TAXONOMY_NAMESPACE_ROOTS.join(", ")}`,
    );
  }
  if (entry["title"] !== undefined && typeof entry["title"] !== "string") {
    errors.push("title: must be a string");
  }
  if (entry["description"] !== undefined && typeof entry["description"] !== "string") {
    errors.push("description: must be a string");
  }

  validateMatch(entry["match"], "match", errors);
  validateScope(entry["scope"], "scope", errors);
  validateProvenance(entry["provenance"], "provenance", errors);

  const parameters = entry["parameters"];
  if (parameters !== undefined) {
    if (!isRecord(parameters)) {
      errors.push("parameters: must be an object");
    } else {
      for (const [key, mapping] of Object.entries(parameters)) {
        if (!PARAMETER_NAME_RE.test(key)) {
          errors.push(`parameters.${key}: parameter names must be lowercase snake_case`);
        }
        validateParameterMapping(mapping, `parameters.${key}`, errors);
      }
    }
  }

  const supersedes = entry["supersedes"];
  if (supersedes !== undefined) {
    if (!Array.isArray(supersedes)) {
      errors.push("supersedes: must be an array");
    } else {
      (supersedes as unknown[]).forEach((id, i) => {
        if (typeof id !== "string" || !ID_RE.test(id)) {
          errors.push(`supersedes[${i}]: must be a lowercase kebab-case entry id`);
        }
      });
    }
  }

  if (entry["deprecated"] !== undefined && typeof entry["deprecated"] !== "boolean") {
    errors.push("deprecated: must be a boolean");
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── Collision policy ──────────────────────────────────────────────────────────

/** A collision between two published entries. See {@link findTaxonomyConflicts}. */
export type TaxonomyConflict = {
  /**
   * - `duplicate-id` - two entries share an `id`.
   * - `ambiguous-mapping` - one raw event would resolve to two different
   *   taxonomy names. The failure that makes consumers untrustworthy.
   * - `duplicate-mapping` - two entries say the same thing; harmless to
   *   consumers, but the redundant one should be dropped or superseded.
   */
  readonly kind: "duplicate-id" | "ambiguous-mapping" | "duplicate-mapping";
  readonly entryIds: readonly [string, string];
  readonly detail: string;
};

function normalizedMatchKey(match: TaxonomyMatch): string {
  const topics = match.topics.map((t) =>
    t.kind === "symbol" ? `symbol:${t.symbol}` : `any:${t.type ?? "*"}`,
  );
  return JSON.stringify({
    topics,
    trailingTopics: match.trailingTopics ?? "forbidden",
    dataShape: match.dataShape ?? "*",
  });
}

function networksOverlap(a: TaxonomyScope, b: TaxonomyScope): boolean {
  if (!a.networks || !b.networks) return true;
  return a.networks.some((n) => b.networks!.includes(n));
}

/**
 * Whether two scopes can name the same deployed contract.
 *
 * Scopes of different kinds are reported as non-overlapping: deciding whether a
 * specific contract ID is also covered by a `wasmHash` or SEP-interface scope
 * needs on-chain state this module deliberately never reads. That case is a
 * reviewer's call, and the schema's `description` says so.
 */
function scopesOverlap(a: TaxonomyScope, b: TaxonomyScope): boolean {
  if (a.kind !== b.kind) return false;
  if (!networksOverlap(a, b)) return false;

  if (a.kind === "contract" && b.kind === "contract") {
    return a.contractIds.some((id) => b.contractIds.includes(id));
  }
  if (a.kind === "wasmHash" && b.kind === "wasmHash") {
    return a.wasmHashes.some((h) => b.wasmHashes.includes(h));
  }
  if (a.kind === "interface" && b.kind === "interface") {
    return a.interface === b.interface;
  }
  return false;
}

/**
 * Applies the collision policy to a set of entries.
 *
 * The rules, in the order a reviewer should read them:
 *
 * 1. **`id` is unique.** Two entries with the same id are the same entry, so
 *    one of them is an accident.
 * 2. **A raw event resolves to exactly one taxonomy name.** Two entries whose
 *    patterns match identically, within scopes that can cover the same
 *    contract, are a conflict - `ambiguous-mapping` if the names differ,
 *    `duplicate-mapping` if they agree.
 * 3. **Supersession is the escape hatch.** If either entry lists the other in
 *    `supersedes`, the overlap is intentional (a corrected mapping replacing an
 *    older one) and is not reported.
 *
 * A taxonomy name is *not* required to be unique across entries: `payment.sent`
 * legitimately has one entry per token implementation. Uniqueness is a property
 * of (pattern, scope), not of the name.
 *
 * @param entries The full published set, or a set plus one candidate submission.
 * @returns Every conflict found, in discovery order. Empty means the set is publishable.
 */
export function findTaxonomyConflicts(
  entries: ReadonlyArray<TaxonomyEntry>,
): ReadonlyArray<TaxonomyConflict> {
  const conflicts: TaxonomyConflict[] = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i]!;
      const b = entries[j]!;

      if (a.id === b.id) {
        conflicts.push({
          kind: "duplicate-id",
          entryIds: [a.id, b.id],
          detail: `two entries share the id "${a.id}"`,
        });
        continue;
      }

      if (a.supersedes?.includes(b.id) || b.supersedes?.includes(a.id)) continue;
      if (normalizedMatchKey(a.match) !== normalizedMatchKey(b.match)) continue;
      if (!scopesOverlap(a.scope, b.scope)) continue;

      conflicts.push(
        a.name === b.name
          ? {
              kind: "duplicate-mapping",
              entryIds: [a.id, b.id],
              detail: `both map the same pattern in an overlapping scope to "${a.name}"`,
            }
          : {
              kind: "ambiguous-mapping",
              entryIds: [a.id, b.id],
              detail: `the same pattern in an overlapping scope maps to both "${a.name}" and "${b.name}"`,
            },
      );
    }
  }

  return conflicts;
}
