import type { SubscriptionAuditEntry, SubscriptionRecord } from "../../src/subscription/types.js";

/**
 * The one property a future contributor is most likely to erode by
 * convenience, asserted at the **type level** rather than left as a comment:
 * a subscription carries no key, no allowance, and no authority over
 * subscriber funds.
 *
 * A comment saying "do not add a signer key here" is advice. This is a build
 * failure: adding `signerKey`, `allowance`, `spendingLimit`, or any of the
 * other names below to `SubscriptionRecord` — or to an audit entry, which is
 * the quieter place to hide one — stops `pnpm test:types` compiling.
 *
 * The list is deliberately a superset of what anyone would plausibly reach
 * for, including the euphemisms.
 */

type Assert<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;

/** True when `T` has no key drawn from `Forbidden`. */
type HasNoKeyOf<T, Forbidden extends string> = IsNever<Extract<keyof T, Forbidden>>;

/**
 * Every name that would represent authority over someone else's funds.
 * Anything added here must never appear on the record or its audit trail.
 */
type AuthorityBearingField =
  // Keys and signers
  | "key"
  | "keys"
  | "signerKey"
  | "signer"
  | "signers"
  | "secret"
  | "secretKey"
  | "privateKey"
  | "seed"
  | "mnemonic"
  | "keypair"
  | "credential"
  | "credentials"
  // Delegated spend
  | "allowance"
  | "allowances"
  | "approval"
  | "spendingLimit"
  | "spendLimit"
  | "budget"
  | "authorization"
  | "auth"
  | "delegate"
  | "delegation"
  | "operator"
  | "custodian"
  // Somewhere to pull funds from
  | "sourceAccount"
  | "fundingAccount"
  | "withdrawFrom"
  | "debitAccount"
  | "vault"
  | "escrow";

// The record itself.
type _RecordHoldsNoAuthority = Assert<HasNoKeyOf<SubscriptionRecord, AuthorityBearingField>>;

// And the audit trail, which is the quieter place to hide one — an entry is
// stored, replayed and returned by the read API exactly like the record is.
type _AuditHoldsNoAuthority = Assert<HasNoKeyOf<SubscriptionAuditEntry, AuthorityBearingField>>;

/**
 * The guard has to actually catch something, or it is decoration. A record
 * with a forbidden field must fail the same check the real one passes.
 */
type Tampered = SubscriptionRecord & { signerKey: string };
type _GuardCatchesATamperedRecord = Assert<
  HasNoKeyOf<Tampered, AuthorityBearingField> extends false ? true : false
>;

/**
 * `subscriber` is an opaque identifier, not something to draw funds from.
 * Keeping it a plain `string` is what stops it quietly becoming a keypair or a
 * funded address later.
 */
type _SubscriberIsOpaque = Assert<SubscriptionRecord["subscriber"] extends string ? true : false>;
