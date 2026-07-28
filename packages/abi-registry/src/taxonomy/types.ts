/**
 * Types mirroring `schema/taxonomy.schema.json` - see `./README.md` for why
 * this record format is a placeholder standing in for issue 7.7.
 */

/**
 * The applicable-contract scope a mapping targets, in decreasing precedence:
 * `contractId` (exact) > `specHash` (WASM/spec-hash family) > `interfaceId`
 * (SEP-interface match). Exactly one key is set per scope.
 */
export type TaxonomyScope =
  | { readonly contractId: string }
  | { readonly specHash: string }
  | { readonly interfaceId: string };

/** One raw-event -> semantic-name mapping within a taxonomy record. */
export type TaxonomyMapping = {
  readonly scope: TaxonomyScope;
  /** The event's decoded first topic symbol (e.g. "transfer", "swap") - not the full topics array. */
  readonly eventTopic: string;
  /** Canonical dot-separated semantic name, e.g. "swap.executed". */
  readonly semantic: string;
  readonly doc?: string;
};

/** A taxonomy document validating against `taxonomy.schema.json`. */
export type TaxonomyRecord = {
  readonly version: string;
  readonly mappings: readonly TaxonomyMapping[];
};

/** Precedence tier a scope resolves to. Order is significant: index 0 is most specific. */
export type TaxonomyTier = "contractId" | "specHash" | "interfaceId";

export const TAXONOMY_TIER_ORDER: readonly TaxonomyTier[] = [
  "contractId",
  "specHash",
  "interfaceId",
];

/** Input to `TaxonomyResolver.resolve()`. `specHash`/`interfaceId` are optional -
 *  omit whichever the caller couldn't determine for this event. */
export type TaxonomyResolveInput = {
  readonly contractId: string;
  readonly eventTopic: string;
  readonly specHash?: string;
  readonly interfaceId?: string;
};

export function tierOf(scope: TaxonomyScope): TaxonomyTier {
  if ("contractId" in scope) return "contractId";
  if ("specHash" in scope) return "specHash";
  return "interfaceId";
}

export function scopeKeyOf(scope: TaxonomyScope): string {
  if ("contractId" in scope) return scope.contractId;
  if ("specHash" in scope) return scope.specHash;
  return scope.interfaceId;
}
