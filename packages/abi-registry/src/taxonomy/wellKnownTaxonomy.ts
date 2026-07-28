/**
 * Bundled initial taxonomy: the SEP-41 / SAC token event set (verified
 * against this package's own `specs/well-known/sac-interface.json` and
 * `aqua.json`, which document the exact "transfer"/"mint"/"burn"/"clawback"/
 * "set_authorized"/"approve" event topics every Stellar Asset Contract
 * emits), plus an illustrative mainnet AMM "swap" shape.
 *
 * The AMM entry is deliberately generic (`interfaceId: "soroban-amm-v1"`,
 * caller-supplied) rather than tied to one protocol's `contractId`/`specHash`,
 * since this repo has no bundled AMM/DEX contract spec to verify an exact
 * topic name against (only token specs live in specs/well-known/ today).
 * Treat it as a starting point, not a verified-on-mainnet fact - a real
 * integration should add contractId/specHash-scoped entries for each AMM it
 * actually indexes, which take precedence over this interface-tier fallback
 * per the resolver's own precedence rules.
 */
import type { TaxonomyMapping, TaxonomyRecord } from "./types.js";

export const SEP41_SAC_INTERFACE_ID = "sep41-sac";
export const SOROBAN_AMM_V1_INTERFACE_ID = "soroban-amm-v1";

const sep41SacMappings: TaxonomyMapping[] = [
  { scope: { interfaceId: SEP41_SAC_INTERFACE_ID }, eventTopic: "transfer", semantic: "token.transferred" },
  { scope: { interfaceId: SEP41_SAC_INTERFACE_ID }, eventTopic: "mint", semantic: "token.minted" },
  { scope: { interfaceId: SEP41_SAC_INTERFACE_ID }, eventTopic: "burn", semantic: "token.burned" },
  { scope: { interfaceId: SEP41_SAC_INTERFACE_ID }, eventTopic: "clawback", semantic: "token.clawed_back" },
];

const ammMappings: TaxonomyMapping[] = [
  { scope: { interfaceId: SOROBAN_AMM_V1_INTERFACE_ID }, eventTopic: "swap", semantic: "swap.executed" },
];

/** The bundled well-known taxonomy record, in `taxonomy.schema.json` shape. */
export const wellKnownTaxonomy: TaxonomyRecord = {
  version: "0.1.0",
  mappings: [...sep41SacMappings, ...ammMappings],
};

/** Pre-validated mappings for `TaxonomyResolver.loadTrusted` - skips the
 *  (redundant, for data defined right here) schema re-validation pass. */
export const wellKnownTaxonomyMappings: readonly TaxonomyMapping[] = wellKnownTaxonomy.mappings;
