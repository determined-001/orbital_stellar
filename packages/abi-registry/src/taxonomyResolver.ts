/**
 * Semantic taxonomy resolver (issue #909, "11.1").
 *
 * `taxonomy.ts` owns the *record format* (issue 7.7): what an entry looks like,
 * how it validates, and when two entries conflict. This file is the engine that
 * uses it - given a raw event, which taxonomy name does it mean?
 *
 * A schema without a resolver is a file format. This is the part that turns
 * `["transfer", <from>, <to>]` on some contract into `payment.sent`.
 *
 * ## What this deliberately does not do
 *
 * It never guesses. An event that no entry covers resolves to `null`, and the
 * caller leaves `semantic` unset rather than inventing a plausible name. A
 * wrong semantic name is worse than an absent one: absent is a gap a consumer
 * can see, wrong is a gap they cannot.
 */

import type {
  TaxonomyEntry,
  TaxonomyMatch,
  TaxonomyNetwork,
  TaxonomyScope,
  TopicMatcher,
} from "./taxonomy.js";
import { findTaxonomyConflicts, validateTaxonomyEntry } from "./taxonomy.js";
import type { PrimitiveType } from "./spec.js";

/**
 * One topic slot of a raw event, as the resolver needs to see it.
 *
 * Symbols carry their text because that is what `symbol` matchers compare.
 * Everything else carries its Soroban type where the decoder knew it - and
 * omits it where it did not, which is a meaningful state rather than an
 * oversight (see {@link matchesTopic}).
 */
export type ResolvableTopic =
  | { readonly kind: "symbol"; readonly symbol: string }
  | { readonly kind: "value"; readonly type?: PrimitiveType };

/** A raw event, reduced to what deciding its meaning actually requires. */
export type ResolvableEvent = {
  /** Emitting contract. Matched against `contract`-scoped entries. */
  readonly contractId: string;
  /** Topics, positional from slot 0. */
  readonly topics: ReadonlyArray<ResolvableTopic>;
  /** Shape of the data payload, where known. */
  readonly dataShape?: "void" | "scalar" | "map" | "vec";
  /** Network the event was observed on. Narrows network-scoped entries. */
  readonly network?: TaxonomyNetwork;
  /**
   * The emitting contract's WASM hash, if known. Required to match
   * `wasmHash`-scoped entries - without it those entries simply do not apply,
   * because a family membership that cannot be checked must not be assumed.
   */
  readonly wasmHash?: string;
  /**
   * SEP interfaces the contract is known to implement, e.g. `["SEP-41"]`.
   * Same rule: an interface that has not been established does not match.
   */
  readonly interfaces?: ReadonlyArray<string>;
};

/** Why an entry applied, so a consumer can judge how much to trust it. */
export type TaxonomyResolution = {
  /** The canonical dot-namespaced name, e.g. `payment.sent`. */
  readonly name: string;
  readonly entryId: string;
  readonly entryVersion: string;
  /** Which scope kind matched - `contract` is the strongest evidence. */
  readonly scope: TaxonomyScope["kind"];
  /** True when the winning entry is retired but kept for historical decoding. */
  readonly deprecated: boolean;
};

/** Thrown when the entry set cannot be trusted to resolve deterministically. */
export class TaxonomyLoadError extends Error {
  constructor(readonly problems: ReadonlyArray<string>) {
    super(
      `TaxonomyResolver: entry set is not loadable:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "TaxonomyLoadError";
  }
}

/**
 * Thrown when one event matches two equally specific entries with different
 * names at resolve time.
 *
 * `findTaxonomyConflicts` catches this at load for entries whose *patterns* are
 * identical. Two entries can still both match one concrete event without having
 * identical patterns - `["transfer", any]` and `["transfer", any:address]`
 * overlap on a real address topic but are different patterns. Erroring here
 * rather than picking one keeps the "a raw event resolves to exactly one name"
 * guarantee true for events, not just for patterns.
 */
export class AmbiguousTaxonomyError extends Error {
  constructor(
    readonly names: ReadonlyArray<string>,
    readonly entryIds: ReadonlyArray<string>,
  ) {
    super(
      `TaxonomyResolver: event matches ${entryIds.length} equally specific entries with different names ` +
        `(${names.join(", ")}) from entries ${entryIds.join(", ")}. ` +
        `Resolve by superseding one, or by narrowing a scope.`,
    );
    this.name = "AmbiguousTaxonomyError";
  }
}

/**
 * Scope specificity, highest wins. This is the precedence the issue names:
 * exact contract, then the spec-hash family, then an interface match, then
 * unmapped.
 *
 * The ordering is an evidence ordering, not a convenience. A `contract` entry
 * is a statement about one deployment somebody looked at. An `interface` entry
 * is a statement about every contract claiming a SEP, which is a much larger
 * claim on much weaker evidence - so it may only ever be a fallback.
 */
const SCOPE_RANK: Record<TaxonomyScope["kind"], number> = {
  contract: 3,
  wasmHash: 2,
  interface: 1,
};

function networkApplies(scope: TaxonomyScope, network?: TaxonomyNetwork): boolean {
  if (!scope.networks || scope.networks.length === 0) return true;
  // A network-scoped entry against an event of unknown network does not apply:
  // assuming the event came from the scoped network is exactly the guess this
  // resolver refuses to make.
  if (!network) return false;
  return scope.networks.includes(network);
}

function scopeApplies(scope: TaxonomyScope, event: ResolvableEvent): boolean {
  if (!networkApplies(scope, event.network)) return false;

  switch (scope.kind) {
    case "contract":
      return scope.contractIds.includes(event.contractId);
    case "wasmHash":
      return (
        event.wasmHash !== undefined && scope.wasmHashes.includes(event.wasmHash.toLowerCase())
      );
    case "interface":
      return event.interfaces?.includes(scope.interface) ?? false;
  }
}

function matchesTopic(matcher: TopicMatcher, topic: ResolvableTopic): boolean {
  if (matcher.kind === "symbol") {
    return topic.kind === "symbol" && topic.symbol === matcher.symbol;
  }

  // `any` with no type constraint accepts any single topic, symbol included.
  if (matcher.type === undefined) return true;

  // A typed `any` against a topic whose type the decoder did not record is a
  // no-match, not a maybe. Treating unknown as compatible would let a name
  // attach to an event nobody verified the shape of.
  if (topic.kind === "symbol") return matcher.type === "symbol";
  return topic.type === matcher.type;
}

function matchesPattern(match: TaxonomyMatch, event: ResolvableEvent): boolean {
  const trailing = match.trailingTopics ?? "forbidden";

  if (event.topics.length < match.topics.length) return false;
  if (trailing === "forbidden" && event.topics.length !== match.topics.length) return false;

  for (let i = 0; i < match.topics.length; i++) {
    if (!matchesTopic(match.topics[i]!, event.topics[i]!)) return false;
  }

  if (match.dataShape !== undefined) {
    // Same rule as topic types: an unconstrained event does not satisfy a
    // constrained pattern.
    if (event.dataShape === undefined) return false;
    if (event.dataShape !== match.dataShape) return false;
  }

  return true;
}

/**
 * Resolves raw events to taxonomy names against a fixed entry set.
 *
 * The set is validated once at construction: invalid entries and conflicting
 * ones both throw, so a resolver that exists is one whose answers are
 * deterministic. Loading a bad set and discovering it per-event is how a
 * taxonomy becomes untrustworthy quietly.
 */
export class TaxonomyResolver {
  private readonly entries: ReadonlyArray<TaxonomyEntry>;
  /** ids superseded by some other entry in the set. */
  private readonly superseded: ReadonlySet<string>;

  constructor(entries: ReadonlyArray<TaxonomyEntry>) {
    const problems: string[] = [];

    entries.forEach((entry, i) => {
      const result = validateTaxonomyEntry(entry);
      if (!result.valid) {
        const id = (entry as { id?: string })?.id ?? `#${i}`;
        problems.push(...result.errors.map((e) => `entry ${id}: ${e}`));
      }
    });

    // Reuses 7.7's collision policy rather than inventing a second one. Only
    // `duplicate-id` and `ambiguous-mapping` block loading: `duplicate-mapping`
    // is two entries agreeing, which is untidy but cannot mislead a consumer.
    for (const conflict of findTaxonomyConflicts(entries)) {
      if (conflict.kind === "duplicate-mapping") continue;
      problems.push(`${conflict.kind} (${conflict.entryIds.join(", ")}): ${conflict.detail}`);
    }

    if (problems.length > 0) throw new TaxonomyLoadError(problems);

    this.entries = entries;
    this.superseded = new Set(entries.flatMap((e) => [...(e.supersedes ?? [])]));
  }

  /** Every entry currently loaded. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * The taxonomy name for `event`, or `null` when nothing covers it.
   *
   * `null` is a normal, expected answer - most contracts on the network have
   * no entry - and the caller must leave `semantic` unset rather than fill it
   * with a guess.
   */
  resolve(event: ResolvableEvent): TaxonomyResolution | null {
    const candidates = this.entries.filter(
      (entry) => scopeApplies(entry.scope, event) && matchesPattern(entry.match, event),
    );
    if (candidates.length === 0) return null;

    // A superseded entry loses to the entry that replaced it whenever both
    // match - that is what makes supersession the documented way to correct a
    // published mapping without a conflict.
    const live = candidates.filter((e) => !this.superseded.has(e.id));
    const pool = live.length > 0 ? live : candidates;

    const bestRank = Math.max(...pool.map((e) => SCOPE_RANK[e.scope.kind]));
    let top = pool.filter((e) => SCOPE_RANK[e.scope.kind] === bestRank);

    // A retired entry is kept published for historical decoding, so it may
    // still answer - but never in preference to a current one at the same rank.
    const current = top.filter((e) => e.deprecated !== true);
    if (current.length > 0) top = current;

    const names = [...new Set(top.map((e) => e.name))];
    if (names.length > 1) {
      throw new AmbiguousTaxonomyError(
        names,
        top.map((e) => e.id),
      );
    }

    const winner = top[0]!;
    return {
      name: winner.name,
      entryId: winner.id,
      entryVersion: winner.version,
      scope: winner.scope.kind,
      deprecated: winner.deprecated === true,
    };
  }
}
