import type {
  Trigger,
  Schedule,
  WorkerDefinition,
  CoverageReason,
  CoverageWindow,
  ExpiringSubscriptionEvent,
  SubscriptionEvent,
  SubscriptionState,
} from "../src/index.js";
import { TriggerNotImplementedError, assertImplementedTrigger } from "../src/index.js";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Type-only exhaustiveness test for the `Trigger` discriminated union (issue
 * #1038, acceptance criterion "types.exhaustive.test-d.ts proves the trigger
 * union is exhaustively handled").
 *
 * This file is never executed. It is compiled by `tsconfig.typetest.json`
 * (wired into the package `test` script, mirroring `pulse-core`) so the
 * TypeScript compiler - not manual inspection - guarantees every trigger kind
 * is handled. Add a member to `Trigger` without updating the switch below and
 * the build fails.
 *
 * The mechanism is the standard `never`-exhaustiveness assignment: once every
 * case in a `switch (trigger.kind)` is handled, the value narrows to `never`
 * in `default`, so `const _x: never = trigger` compiles. Miss a case and the
 * assignment is a compile error.
 */

// Positive case: a fully exhaustive switch must compile.
export function describeTrigger(trigger: Trigger): string {
  switch (trigger.kind) {
    case "time":
    case "event":
    case "computation":
      return trigger.kind;
    default: {
      const _exhaustive: never = trigger;
      return _exhaustive;
    }
  }
}

// Negative case: an intentionally incomplete switch must NOT compile. Only
// "time" is handled, so in `default` the value is not `never` and the
// assignment is an error - which `@ts-expect-error` asserts. If `Trigger`
// ever shrank to a single member (making this exhaustive on its own), the
// directive would become unused and the build would fail, proving the guard
// genuinely detects unhandled variants.
export function describeIncompleteIsRejected(trigger: Trigger): string {
  switch (trigger.kind) {
    case "time":
      return trigger.kind;
    default: {
      // @ts-expect-error - "event" and "computation" are unhandled here.
      const _exhaustive: never = trigger;
      return _exhaustive;
    }
  }
}

// No-default-clause variant, same shape as pulse-core's: TypeScript's
// control-flow analysis narrows the union after the switch, so the explicit
// `string` return type is satisfiable only while every branch is covered.
export function describeTriggerNoDefault(trigger: Trigger): string {
  switch (trigger.kind) {
    case "time":
    case "event":
    case "computation":
      return trigger.kind;
  }
}

// @ts-expect-error - "computation" is not handled, so this does not return
// `string` on every path.
export function describeMissingBranchNoDefault(trigger: Trigger): string {
  switch (trigger.kind) {
    case "time":
    case "event":
      return trigger.kind;
  }
}

// `assertImplementedTrigger` must narrow `Trigger` to the `time` member.
export function afterAssertImplemented(trigger: Trigger): string {
  assertImplementedTrigger(trigger);
  type _IsTimeTrigger = Assert<Equal<(typeof trigger)["kind"], "time">>;
  return trigger.schedule.kind;
}

// `TriggerNotImplementedError#kind` must exclude "time" - it is only ever
// thrown for the two trigger kinds that are not implemented yet.
export function unimplementedKindNeverTime(error: TriggerNotImplementedError): void {
  // @ts-expect-error - "time" triggers never produce this error.
  const _isTime: "time" = error.kind;
}

// Schedule's two variants must both carry the required `timezone` field,
// regardless of `kind`.
export function scheduleTimezoneIsRequired(schedule: Schedule): string {
  return schedule.timezone;
}

// `WorkerDefinition` must not expose any field that could carry a user's
// secret key (acceptance criterion: "There is no field anywhere in the model
// that can carry a user's secret key"). Extending the forbidden-key list
// below and having it stay `never` is itself the enforcement.
type ForbiddenSecretKeys =
  "secret" | "secretKey" | "privateKey" | "signingKey" | "signer" | "seed" | "mnemonic";
type _NoSecretField = Assert<Equal<Extract<keyof WorkerDefinition, ForbiddenSecretKeys>, never>>;

// Neither a billing signal nor a coverage record may carry a payment
// credential (issue #1067, acceptance criterion "No payment credentials pass
// through worker-core"). The operated adapter resolves its own customer
// mapping on its own side; there must be nowhere in these types to put a card
// token, a customer secret or an API key. Extending the forbidden-key list
// below and having it stay `never` is itself the enforcement.
type ForbiddenPaymentKeys =
  | "card"
  | "cardToken"
  | "paymentMethod"
  | "paymentToken"
  | "customerSecret"
  | "apiKey"
  | "credential"
  | "credentials"
  | "secret"
  | "token";
type _NoCredentialOnEvent = Assert<
  Equal<Extract<keyof SubscriptionEvent, ForbiddenPaymentKeys>, never>
>;
type _NoCredentialOnExpiringEvent = Assert<
  Equal<Extract<keyof ExpiringSubscriptionEvent, ForbiddenPaymentKeys>, never>
>;
type _NoCredentialOnCoverageWindow = Assert<
  Equal<Extract<keyof CoverageWindow, ForbiddenPaymentKeys>, never>
>;

// Coverage is a closed set of reasons, and grace is one of them - a lapse
// cannot be recorded as anything other than uncovered because the reason and
// the flag are validated together at write time (see coverage.ts).
type _CoverageReasons = Assert<Equal<CoverageReason, "active" | "grace" | "lapsed" | "cancelled">>;
type _SubscriptionStates = Assert<
  Equal<SubscriptionState, "active" | "expiring" | "lapsed" | "cancelled">
>;
