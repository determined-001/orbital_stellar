/**
 * Semantic taxonomy resolver: maps a raw Soroban event's
 * `(contractId, eventTopic, specHash?, interfaceId?)` to a canonical semantic
 * name (e.g. "swap.executed"), deterministically, per a fixed precedence
 * order - never a silent pick between conflicting rules.
 *
 * Precedence: exact `contractId` > `specHash` (WASM/spec family) >
 * `interfaceId` (SEP-interface match) > unmapped. A "tie" only exists within
 * one tier (same scope + eventTopic mapped to two *different* semantics) -
 * that's a load-time `TaxonomyConflictError`, not something resolved here.
 */
import { TaxonomyConflictError } from "./errors.js";
import { parseTaxonomyRecord } from "./validateTaxonomyRecord.js";
import { scopeKeyOf, tierOf, TAXONOMY_TIER_ORDER } from "./types.js";
import type { TaxonomyMapping, TaxonomyRecord, TaxonomyResolveInput, TaxonomyTier } from "./types.js";

const KEY_SEP = " ";

function mappingKey(scopeKey: string, eventTopic: string): string {
  return `${scopeKey}${KEY_SEP}${eventTopic}`;
}

export class TaxonomyResolver {
  private readonly tiers: Record<TaxonomyTier, Map<string, string>> = {
    contractId: new Map(),
    specHash: new Map(),
    interfaceId: new Map(),
  };

  /** Prefer `loadTaxonomyResolver` - this constructor is not itself validated. */
  private constructor() {}

  /**
   * Validates each record against `taxonomy.schema.json`'s constraints, then
   * registers every mapping. Throws `InvalidTaxonomyRecordError` on a
   * malformed record, or `TaxonomyConflictError` on two same-tier rules for
   * the same scope + eventTopic that disagree on the semantic name.
   */
  static load(records: readonly unknown[]): TaxonomyResolver {
    const resolver = new TaxonomyResolver();
    for (const doc of records) {
      const record: TaxonomyRecord = parseTaxonomyRecord(doc);
      for (const mapping of record.mappings) {
        resolver.register(mapping);
      }
    }
    return resolver;
  }

  /** Same as `load`, but skips schema validation - for mappings already known
   *  to be well-typed (e.g. the bundled well-known taxonomy). Conflict
   *  checking still applies. */
  static loadTrusted(mappings: readonly TaxonomyMapping[]): TaxonomyResolver {
    const resolver = new TaxonomyResolver();
    for (const mapping of mappings) {
      resolver.register(mapping);
    }
    return resolver;
  }

  private register(mapping: TaxonomyMapping): void {
    const tier = tierOf(mapping.scope);
    const key = mappingKey(scopeKeyOf(mapping.scope), mapping.eventTopic);
    const index = this.tiers[tier];
    const existing = index.get(key);
    if (existing !== undefined && existing !== mapping.semantic) {
      throw new TaxonomyConflictError(tier, scopeKeyOf(mapping.scope), mapping.eventTopic, existing, mapping.semantic);
    }
    index.set(key, mapping.semantic);
  }

  /**
   * Resolves a semantic name for the given event coordinates, checking tiers
   * in precedence order and returning the first hit. `undefined` means
   * genuinely unmapped - never guessed, never a fallback string.
   */
  resolve(input: TaxonomyResolveInput): string | undefined {
    for (const tier of TAXONOMY_TIER_ORDER) {
      const scopeValue = tier === "contractId" ? input.contractId : tier === "specHash" ? input.specHash : input.interfaceId;
      if (scopeValue === undefined) continue;
      const hit = this.tiers[tier].get(mappingKey(scopeValue, input.eventTopic));
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
}

/** Builds a resolver from one or more documents validating against `taxonomy.schema.json`. */
export function loadTaxonomyResolver(records: readonly unknown[]): TaxonomyResolver {
  return TaxonomyResolver.load(records);
}
