/**
 * Declarative conditions for the event-based trigger class (issue 20.6).
 *
 * A trigger condition is a predicate over `NormalizedEvent` — which is exactly
 * what `pulse-core` already produces. This module compiles a *declarative*
 * condition spec into that predicate rather than accepting a function, and the
 * distinction is the whole design:
 *
 *   - 19.1 verifies a worker by asking "should this have fired?" over a
 *     historical ledger range. That question only has an answer if the
 *     condition is a pure function of chain data. An arbitrary callback can
 *     read a clock, a database or an HTTP response, and a predicate that reads
 *     mutable off-chain state is not verifiable — it belongs in 20.7.
 *   - A declarative spec cannot do any of that. Determinism is structural here,
 *     not a rule contributors are asked to remember.
 *
 * The matching primitives are `pulse-core`'s own — `isEventType` for type
 * narrowing, the `ContractFilter` shape and its validator for contract
 * matching — rather than a new matching language.
 */
import { isEventType, validateContractFilters } from "@orbital-stellar/pulse-core";
import type { ContractFilter, NormalizedEvent } from "@orbital-stellar/pulse-core";

/** A compiled trigger condition: a pure predicate over one normalized event. */
export type EventPredicate = (event: NormalizedEvent) => boolean;

/**
 * A declarative event-trigger condition.
 *
 * Every field narrows; an event fires the trigger only when it satisfies all
 * the fields that are present. An empty spec is rejected at compile time
 * rather than matching everything — a worker that fires on every event on the
 * network is never what someone meant.
 */
export type EventConditionSpec = {
  /**
   * Normalized event types this condition accepts, matched with
   * `pulse-core`'s `isEventType`. At least one type is required.
   */
  readonly eventTypes: ReadonlyArray<NormalizedEvent["type"]>;

  /**
   * Optional contract-event narrowing, in `pulse-core`'s own `ContractFilter`
   * shape and validated by its own validator, so a condition and a
   * subscription describe contracts the same way.
   */
  readonly contract?: ContractFilter;

  /**
   * Optional participant narrowing. An event matches when any of these
   * addresses appears in a role the event's type defines (`from`/`to` on a
   * payment, `account` on an account event, `contractId` on a contract event).
   */
  readonly addresses?: ReadonlyArray<string>;

  /**
   * When true, a contract event only matches if the emitting call succeeded.
   * Defaults to true: a reverted call did not change chain state, so treating
   * it as a trigger condition would fire a worker on something that did not
   * happen.
   */
  readonly requireSuccessfulContractCall?: boolean;
};

/** Compilation result. Errors are returned, never thrown — registration reports all of them at once. */
export type CompileResult =
  | { readonly ok: true; readonly predicate: EventPredicate }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

/**
 * Event types that are market data rather than settlement facts.
 *
 * §C.1's build order puts anything trade-signal shaped in W4, behind the vault
 * pattern, because a worker that trades on a price needs custody guarantees
 * that W2 does not have. A condition over offers or pool reserves is a price
 * observation in all but name, so registration refuses it here — see
 * {@link TRADE_SIGNAL_REJECTION}.
 *
 * This is a deliberate over-approximation. Some legitimate non-trading worker
 * will want `offer.deleted`, and will have to wait for W4 or argue the case.
 * The alternative — guessing intent from a condition — fails in the direction
 * that matters more.
 */
const TRADE_SIGNAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  "offer.created",
  "offer.updated",
  "offer.deleted",
  "lp.deposited",
  "lp.withdrawn",
]);

export const TRADE_SIGNAL_REJECTION =
  "trade-signal conditions are not available in W2. Conditions over offers and " +
  "liquidity pools are price observations, and a worker acting on a price needs " +
  "the custody guarantees of the W4 vault pattern. See §C.1's build order.";

/**
 * Every event type `pulse-core` normalizes. Kept as data rather than derived
 * from the union, because a runtime check needs runtime values — and a new
 * event type added to `pulse-core` should fail a spec that names it until it
 * has been considered here, rather than silently becoming triggerable.
 */
const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "payment.received",
  "payment.sent",
  "payment.self",
  "account.created",
  "account.merged",
  "account.options_changed",
  "account.bump_sequence",
  "trustline.added",
  "trustline.removed",
  "trustline.updated",
  "trustline.authorized",
  "trustline.deauthorized",
  "offer.created",
  "offer.updated",
  "offer.deleted",
  "data.set",
  "data.cleared",
  "claimable.created",
  "claimable.claimed",
  "lp.deposited",
  "lp.withdrawn",
  "asset.clawback",
  "fee.incurred",
  "contract.invoked",
  "contract.emitted",
]);

const CONTRACT_EVENT_TYPES: ReadonlySet<string> = new Set(["contract.invoked", "contract.emitted"]);

/**
 * Read every address-shaped field an event carries, without knowing which arm
 * of the union it is.
 *
 * Deliberately structural rather than a per-type switch: the union has eighteen
 * arms and grows, and a switch that forgets one silently narrows to nothing —
 * which reads at registration as "this condition never matches" long after
 * anyone would connect it to a missing case.
 */
function addressesOf(event: NormalizedEvent): string[] {
  const record = event as unknown as Record<string, unknown>;
  const fields = ["from", "to", "account", "contractId", "sourceAccount", "destination", "trustor"];
  const found: string[] = [];
  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && value.length > 0) found.push(value);
  }
  return found;
}

/** Does this contract event match `filter`? Mirrors the engine's own filter semantics. */
function matchesContractFilter(event: NormalizedEvent, filter: ContractFilter): boolean {
  if (!isEventType(event, "contract.invoked", "contract.emitted")) return false;

  if (filter.contractIds && filter.contractIds.length > 0) {
    if (!filter.contractIds.includes(event.contractId)) return false;
  }

  if (filter.topics && filter.topics.length > 0) {
    // Only `contract.emitted` carries topics; an invocation cannot satisfy a
    // topic filter, and must not be treated as if the filter were absent.
    if (!isEventType(event, "contract.emitted")) return false;
    const topics = event.topics;
    const anySetMatches = filter.topics.some((wanted) =>
      wanted.every((segment, index) => segment === "*" || topics[index] === segment),
    );
    if (!anySetMatches) return false;
  }

  return true;
}

/**
 * Compile a declarative condition into a predicate, or report why it cannot be.
 *
 * Every rejection here is a registration-time gate, not a warning. 20.6's
 * implementation notes are explicit that the trade-signal refusal in particular
 * "is a real gate, not a warning. It is how the fixed build order is enforced
 * against a well-meaning contributor."
 */
export function compileEventCondition(spec: EventConditionSpec): CompileResult {
  const errors: string[] = [];

  if (!Array.isArray(spec.eventTypes) || spec.eventTypes.length === 0) {
    errors.push(
      "eventTypes must name at least one normalized event type — a condition with no type " +
        "would fire on every event on the network",
    );
  } else {
    for (const type of spec.eventTypes) {
      if (!KNOWN_EVENT_TYPES.has(type)) {
        errors.push(`unknown event type "${type}"`);
      }
    }
    const tradeSignals = spec.eventTypes.filter((type) => TRADE_SIGNAL_EVENT_TYPES.has(type));
    if (tradeSignals.length > 0) {
      errors.push(`${TRADE_SIGNAL_REJECTION} Rejected types: ${tradeSignals.join(", ")}.`);
    }
  }

  if (spec.contract !== undefined) {
    // `pulse-core`'s own validator, so a condition and a subscription accept
    // exactly the same contract filters.
    const filterErrors = validateContractFilters([spec.contract]);
    if (filterErrors) errors.push(...filterErrors);

    const namesContractEvent = (spec.eventTypes ?? []).some((type) =>
      CONTRACT_EVENT_TYPES.has(type),
    );
    if (!namesContractEvent) {
      errors.push(
        "a contract filter only narrows contract.invoked / contract.emitted, but eventTypes " +
          "names neither — this condition can never match",
      );
    }
  }

  if (spec.addresses !== undefined && spec.addresses.length === 0) {
    errors.push("addresses, when present, must name at least one address");
  }

  if (errors.length > 0) return { ok: false, errors };

  const types = [...spec.eventTypes] as NormalizedEvent["type"][];
  const wantedAddresses = spec.addresses ? new Set(spec.addresses) : null;
  const contractFilter = spec.contract;
  const requireSuccess = spec.requireSuccessfulContractCall ?? true;

  const predicate: EventPredicate = (event) => {
    if (!isEventType(event, ...types)) return false;

    if (requireSuccess && CONTRACT_EVENT_TYPES.has(event.type)) {
      // Undefined means the source did not report it. Treated as a match
      // rather than a rejection: refusing every event whose success is
      // unreported would make firing depend on how much the source told us,
      // and 19.1 has `unverifiable` for that ambiguity rather than a silent no.
      const succeeded = (event as { inSuccessfulContractCall?: boolean }).inSuccessfulContractCall;
      if (succeeded === false) return false;
    }

    if (contractFilter && !matchesContractFilter(event, contractFilter)) return false;

    if (wantedAddresses) {
      const present = addressesOf(event);
      if (!present.some((address) => wantedAddresses.has(address))) return false;
    }

    return true;
  };

  return { ok: true, predicate };
}
