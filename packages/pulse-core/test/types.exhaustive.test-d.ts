import type { NormalizedEvent } from "../src/index.js";
import { Watcher } from "../src/Watcher.js";
import type {
  PaymentEvent,
  WatcherNotification,
  DecodeFailedNotification,
  UnrecognizedOperationTypeNotification,
} from "../src/index.js";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Type-only exhaustiveness test for the `NormalizedEvent` discriminated union
 * (issue #298 - M3 "discriminated union refinement").
 *
 * This file is never executed. It is compiled by `tsconfig.typetest.json`
 * (wired into the package `test` script) so that the TypeScript compiler - not
 * manual inspection - guarantees every event type is handled. Add a new member
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
    case "asset.clawback":
    case "fee.incurred":
    case "contract.invoked":
    case "contract.emitted":
    case "anchor.transaction_status_changed":
    case "anchor.deposit.initiated":
    case "anchor.deposit.pending":
    case "anchor.deposit.completed":
    case "anchor.deposit.refunded":
    case "anchor.deposit.failed":
    case "anchor.withdrawal.initiated":
    case "anchor.withdrawal.pending":
    case "anchor.withdrawal.completed":
    case "anchor.withdrawal.refunded":
    case "anchor.withdrawal.failed":
    case "anchor.payment.initiated":
    case "anchor.payment.pending":
    case "anchor.payment.completed":
    case "anchor.payment.refunded":
    case "anchor.payment.failed":
      return event.type;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

// Negative case: an intentionally incomplete switch must NOT compile. Only one
// branch is handled, so in `default` the value is not `never` and the assignment
// is an error - which `@ts-expect-error` asserts. If the union ever shrank to a
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
    case "asset.clawback":
    case "fee.incurred":
    case "contract.invoked":
    case "contract.emitted":
    case "anchor.transaction_status_changed":
    case "anchor.deposit.initiated":
    case "anchor.deposit.pending":
    case "anchor.deposit.completed":
    case "anchor.deposit.refunded":
    case "anchor.deposit.failed":
    case "anchor.withdrawal.initiated":
    case "anchor.withdrawal.pending":
    case "anchor.withdrawal.completed":
    case "anchor.withdrawal.refunded":
    case "anchor.withdrawal.failed":
    case "anchor.payment.initiated":
    case "anchor.payment.pending":
    case "anchor.payment.completed":
    case "anchor.payment.refunded":
    case "anchor.payment.failed":
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

export function testWatcherOnInference() {
  const watcher = new Watcher("G...");

  watcher.on("payment.received", (e) => {
    type _IsPaymentEvent = Assert<Equal<typeof e, PaymentEvent & { readonly timestampDate: Date }>>;
    const _to = e.to;
    const _from = e.from;
    const _amount = e.amount;
    const _date = e.timestampDate;
  });

  watcher.on("engine.reconnecting", (e) => {
    type _IsWatcherNotification = Assert<Equal<typeof e, WatcherNotification>>;
    const _attempt = e.attempt;
  });

  watcher.on("event.decode_failed", (e) => {
    type _IsDecodeFailedNotification = Assert<Equal<typeof e, DecodeFailedNotification>>;
    const _error = e.error;
  });

  watcher.on("engine.unrecognized_operation_type", (e) => {
    type _IsUnrecognizedOperationTypeNotification = Assert<
      Equal<typeof e, UnrecognizedOperationTypeNotification>
    >;
    const _operationType = e.operationType;
    const _record = e.record;
  });

  watcher.on("*", (_e) => {
    type _IsFullUnion = Assert<
      Equal<
        typeof _e,
        | NormalizedEvent
        | WatcherNotification
        | DecodeFailedNotification
        | UnrecognizedOperationTypeNotification
      >
    >;
  });

  watcher.on("unknown.event", (_e) => {
    type _IsFullUnion = Assert<
      Equal<
        typeof _e,
        | NormalizedEvent
        | WatcherNotification
        | DecodeFailedNotification
        | UnrecognizedOperationTypeNotification
      >
    >;
  });
}

/**
 * The classic (Horizon-sourced) half of the taxonomy carries the same
 * transaction-identity fields the Soroban half already did. They are optional
 * on every event - a transport that cannot supply them still produces a valid
 * event - so reading one must narrow to `... | undefined`, and assigning a
 * required field's type to it must not compile.
 */
export function assertClassicIdentityIsOptional(event: NormalizedEvent): void {
  if (event.type === "payment.received") {
    type _TxHash = Assert<Equal<typeof event.txHash, string | undefined>>;
    type _Ledger = Assert<Equal<typeof event.ledger, number | undefined>>;
    type _Memo = Assert<Equal<typeof event.memo, string | undefined>>;
  }

  if (event.type === "account.merged") {
    type _TxHash = Assert<Equal<typeof event.txHash, string | undefined>>;
    type _Ledger = Assert<Equal<typeof event.ledger, number | undefined>>;
    type _Memo = Assert<Equal<typeof event.memo, string | undefined>>;
  }

  if (event.type === "lp.deposited") {
    type _TxHash = Assert<Equal<typeof event.txHash, string | undefined>>;
  }
}

/** An event built without the identity fields still satisfies the type - they are additive. */
export const _paymentWithoutIdentity: Omit<PaymentEvent, "timestampDate"> = {
  type: "payment.received",
  to: "GDEST" as PaymentEvent["to"],
  from: "GSRC" as PaymentEvent["from"],
  amount: "10" as PaymentEvent["amount"],
  asset: "XLM",
  timestamp: "2026-01-01T00:00:00Z",
};

/** ...and one built with them satisfies it too. */
export const _paymentWithIdentity: Omit<PaymentEvent, "timestampDate"> = {
  ..._paymentWithoutIdentity,
  txHash: "abc",
  ledger: 42,
  memo: "invoice-1",
};
