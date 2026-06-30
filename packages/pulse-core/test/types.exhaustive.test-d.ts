import type { NormalizedEvent } from "../src/index.js";

/**
 * Type-only exhaustiveness test for the `NormalizedEvent` discriminated union
 * (issue #298 — M3 "discriminated union refinement").
 *
 * This file is never executed. It is compiled by `tsconfig.typetest.json`
 * (wired into the package `test` script) so that the TypeScript compiler — not
 * manual inspection — guarantees every event type is handled. Add a new member
 * to the `NormalizedEvent` union without updating the switch below and the build
 * fails.
 *
 * The mechanism is the standard `never` exhaustiveness assignment: in a `switch`
 * over `event.type`, once every case is handled the value narrows to `never` in
 * the `default` branch, so `const _x: never = event` compiles. Leave a case out
 * and `event` is no longer `never`, so the assignment is a compile error.
 */

// Positive case: a fully exhaustive switch must compile.
export function assertExhaustive(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self":
    case "account.created":
    case "account.options_changed":
    case "account.merged":
    case "account.bump_sequence":
    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated":
    case "trustline.authorized":
    case "trustline.deauthorized":
    case "offer.created":
    case "offer.updated":
    case "offer.deleted":
    case "data.set":
    case "data.cleared":
    case "claimable.created":
    case "claimable.claimed":
    case "lp.deposited":
    case "lp.withdrawn":
    case "contract.invoked":
    case "contract.emitted":
      return event.type;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// Negative case: an intentionally incomplete switch must NOT compile. Only one
// branch is handled, so in `default` the value is not `never` and the assignment
// is an error — which `@ts-expect-error` asserts. If the union ever shrank to a
// single member (making this exhaustive), the directive would become unused and
// the build would fail, proving the guard genuinely detects unhandled variants.
export function assertIncompleteIsRejected(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
      return event.type;
    default: {
      // @ts-expect-error - remaining NormalizedEvent variants are unhandled here.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// No-default-clause variant (M3 "done when" requirement)
// ---------------------------------------------------------------------------

/**
 * Positive case: exhaustive switch with NO default clause.  TypeScript's
 * control-flow analysis narrows the union after the switch; when every branch
 * is covered the function's return type `string` is satisfied.  Omit a branch
 * and the function no longer returns `string` on all paths.
 */
export function assertExhaustiveNoDefault(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self":
    case "account.created":
    case "account.options_changed":
    case "account.merged":
    case "account.bump_sequence":
    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated":
    case "trustline.authorized":
    case "trustline.deauthorized":
    case "offer.created":
    case "offer.updated":
    case "offer.deleted":
    case "data.set":
    case "data.cleared":
    case "claimable.created":
    case "claimable.claimed":
    case "lp.deposited":
    case "lp.withdrawn":
    case "contract.invoked":
    case "contract.emitted":
      return event.type;
  }
}

/**
 * Negative case: incomplete switch with NO default clause and one omitted
 * branch.  The missing `"contract.emitted"` case means the function does not
 * return `string` on all paths, producing a compile error that
 * `@ts-expect-error` asserts.  Add `"contract.emitted"` back (or the union
 * loses that member) and the directive becomes unused, failing the build.
 */
// @ts-expect-error - contract.emitted is not handled here.
export function assertMissingBranchNoDefault(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self":
    case "account.created":
    case "account.options_changed":
    case "account.merged":
    case "account.bump_sequence":
    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated":
    case "trustline.authorized":
    case "trustline.deauthorized":
    case "offer.created":
    case "offer.updated":
    case "offer.deleted":
    case "data.set":
    case "data.cleared":
    case "claimable.created":
    case "claimable.claimed":
    case "lp.deposited":
    case "lp.withdrawn":
    case "contract.invoked":
      return event.type;
  }
}
