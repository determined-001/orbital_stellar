/**
 * Discriminated union types for Stellar Claimable Balance predicates
 * Enables type-safe pattern matching and evaluation of claim conditions
 */

/**
 * Unconditional predicate - no restrictions, balance can be claimed immediately
 */
export interface UnconditionalPredicate {
  type: "unconditional";
}

/**
 * Negation predicate - inverts the result of another predicate
 */
export interface NotPredicate {
  type: "not";
  predicate: ClaimPredicate;
}

/**
 * Conjunction predicate - all child predicates must be true
 */
export interface AndPredicate {
  type: "and";
  predicates: ClaimPredicate[];
}

/**
 * Disjunction predicate - at least one child predicate must be true
 */
export interface OrPredicate {
  type: "or";
  predicates: ClaimPredicate[];
}

/**
 * Absolute time predicate - balance can only be claimed before a specific timestamp
 */
export interface AbsBeforePredicate {
  type: "abs_before";
  timestamp: string; // ISO8601 timestamp
}

/**
 * Relative time predicate - balance can only be claimed before a relative time from close time
 */
export interface RelBeforePredicate {
  type: "rel_before";
  seconds: string; // Duration in seconds
}

/**
 * Discriminated union of all possible claim predicate types
 */
export type ClaimPredicate =
  | UnconditionalPredicate
  | NotPredicate
  | AndPredicate
  | OrPredicate
  | AbsBeforePredicate
  | RelBeforePredicate;

/**
 * Narrows a predicate to a specific type
 * Useful for TypeScript type guards
 */
export function isClaimPredicateType<T extends ClaimPredicate["type"]>(
  predicate: ClaimPredicate,
  type: T,
): predicate is Extract<ClaimPredicate, { type: T }> {
  return predicate.type === type;
}

/**
 * Evaluates a claim predicate against a given timestamp
 *
 * @param predicate - The claim predicate to evaluate
 * @param nowSeconds - Current time in UNIX seconds (from ledger close time)
 * @returns true if the predicate is satisfied, false otherwise
 */
export function evaluatePredicate(predicate: ClaimPredicate, nowSeconds: number): boolean {
  switch (predicate.type) {
    case "unconditional":
      return true;

    case "not":
      return !evaluatePredicate(predicate.predicate, nowSeconds);

    case "and":
      return predicate.predicates.every((p) => evaluatePredicate(p, nowSeconds));

    case "or":
      return predicate.predicates.some((p) => evaluatePredicate(p, nowSeconds));

    case "abs_before": {
      // Parse ISO8601 timestamp to UNIX seconds
      const beforeSeconds = Math.floor(new Date(predicate.timestamp).getTime() / 1000);
      return nowSeconds < beforeSeconds;
    }

    case "rel_before": {
      // Relative time is given in seconds
      const beforeSeconds = parseInt(predicate.seconds, 10);
      return nowSeconds < beforeSeconds;
    }

    default: {
      // Exhaustiveness check - TypeScript will error if a case is missing
      const _exhaustive: never = predicate;
      return _exhaustive;
    }
  }
}

/**
 * Converts a Stellar SDK predicate object (with optional fields) to a typed ClaimPredicate
 * This ensures proper type narrowing and enables exhaustive pattern matching
 *
 * @param rawPredicate - Raw predicate object from Stellar SDK
 * @returns Properly typed ClaimPredicate
 * @throws Error if predicate structure is invalid or ambiguous
 */
export function normalizeClaimPredicate(rawPredicate: Record<string, unknown>): ClaimPredicate {
  // Check for unconditional
  if (rawPredicate.unconditional === true) {
    return { type: "unconditional" };
  }

  // Check for not
  if (rawPredicate.not !== undefined) {
    return {
      type: "not",
      predicate: normalizeClaimPredicate(rawPredicate.not as Record<string, unknown>),
    };
  }

  // Check for and
  if (Array.isArray(rawPredicate.and)) {
    return {
      type: "and",
      predicates: (rawPredicate.and as unknown[]).map((p) =>
        normalizeClaimPredicate(p as Record<string, unknown>),
      ),
    };
  }

  // Check for or
  if (Array.isArray(rawPredicate.or)) {
    return {
      type: "or",
      predicates: (rawPredicate.or as unknown[]).map((p) =>
        normalizeClaimPredicate(p as Record<string, unknown>),
      ),
    };
  }

  // Check for abs_before
  if (typeof rawPredicate.abs_before === "string") {
    return {
      type: "abs_before",
      timestamp: rawPredicate.abs_before,
    };
  }

  // Check for rel_before
  if (typeof rawPredicate.rel_before === "string") {
    return {
      type: "rel_before",
      seconds: rawPredicate.rel_before,
    };
  }

  throw new Error(`Invalid or ambiguous claim predicate: ${JSON.stringify(rawPredicate)}`);
}
