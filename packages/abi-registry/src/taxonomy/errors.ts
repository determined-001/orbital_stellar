import type { TaxonomyTier } from "./types.js";

/**
 * Thrown at load time when two mappings at the same precedence tier target
 * the same scope + eventTopic with *different* semantic names. This is the
 * collision policy the acceptance criteria requires: a load-time error, never
 * a silent pick of whichever mapping happened to load first. Registering the
 * same (tier, scopeKey, eventTopic, semantic) twice is a harmless duplicate,
 * not a conflict, and does not throw.
 */
export class TaxonomyConflictError extends Error {
  constructor(
    readonly tier: TaxonomyTier,
    readonly scopeKey: string,
    readonly eventTopic: string,
    readonly existingSemantic: string,
    readonly incomingSemantic: string,
  ) {
    super(
      `[abi-registry] taxonomy conflict at "${tier}" tier: scope "${scopeKey}" + eventTopic "${eventTopic}" ` +
        `already maps to "${existingSemantic}", cannot also map to "${incomingSemantic}". ` +
        "Two equally specific rules must agree, or one must be removed - this is never resolved silently.",
    );
    this.name = "TaxonomyConflictError";
  }
}

/** Thrown when a `TaxonomyRecord` (or one of its mappings) doesn't validate
 *  against `taxonomy.schema.json`'s constraints. */
export class InvalidTaxonomyRecordError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`[abi-registry] invalid taxonomy record:\n  ${issues.join("\n  ")}`);
    this.name = "InvalidTaxonomyRecordError";
  }
}
