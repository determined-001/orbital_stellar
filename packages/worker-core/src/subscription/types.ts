import type { TierId } from "../backstop/tiers.js";

/**
 * The subscription record (20.5).
 *
 * A subscriber subscribes to an offering and is notified when their worker
 * fires or misses. That is the entire relationship: **notification and
 * billing.** The record is what later tells W3 what is backstopped and at
 * which tier.
 *
 * What is deliberately absent is the point. A subscription carries no key, no
 * allowance, no delegated signer, no spending limit and no address the
 * operator may draw from — nothing that would let anyone move the subscriber's
 * funds. That is the worker layer's second rule
 * (`docs/design/workers.md`), and it is asserted at the type level in
 * `test/subscription/noAuthority.test-d.ts` rather than left as a comment,
 * because it is the property a future contributor is most likely to erode by
 * convenience: one `signerKey?: string` "just for the backstop" and the layer
 * is a custody product.
 */

/** Lifecycle state. `cancelled` is terminal. */
export type SubscriptionStatus = "active" | "paused" | "cancelled";

/**
 * Service tier. The definitions — latency bound, grace period, price and the
 * conditions under which intervention is guaranteed — live in
 * `../backstop/tiers.js`, which is also what decides which tiers are
 * registrable today (21.3).
 */
export type SubscriptionTier = TierId;

/** Lifecycle transitions, each of which appends an audit entry. */
export type SubscriptionAction = "create" | "pause" | "resume" | "cancel" | "change-tier";

/**
 * One entry of the audit trail.
 *
 * Append-only and never rewritten: "when did this subscription stop being
 * billable" and "when did notifications stop" have to be answerable after the
 * fact, from the record alone, without trusting the operator's memory.
 */
export interface SubscriptionAuditEntry {
  readonly action: SubscriptionAction;
  /** Subscription version this entry was written at. */
  readonly version: number;
  /** Tier in force after this entry. Lets a reader replay what was promised. */
  readonly tier: TierId;
  /** Ledger-independent wall clock, epoch ms. */
  readonly at: number;
  readonly from: SubscriptionStatus | null;
  readonly to: SubscriptionStatus;
  /**
   * Window index this took effect in, so "cancellation took effect within one
   * window" is checkable rather than asserted.
   */
  readonly window: number;
  /** Free-text reason, subscriber- or operator-supplied. Never a credential. */
  readonly reason?: string;
}

export interface SubscriptionRecord {
  readonly id: string;
  /**
   * Subscription version. Starts at 1 and increments on a **tier change**.
   *
   * A tier change is a new version rather than an edit because the tier is the
   * guarantee: what was promised between window 10 and window 40 has to stay
   * answerable after the tier moves, or an SLO dispute becomes an argument
   * about what the record used to say. Lifecycle transitions (pause, resume,
   * cancel) do not change what was promised, so they do not bump it.
   */
  readonly version: number;
  /** Opaque subscriber identifier. Not a key, not an address to draw from. */
  readonly subscriber: string;
  /** The offering being subscribed to. */
  readonly offering: string;
  /** Where fire/miss notifications are delivered. Validated before storage. */
  readonly webhookTarget: string;
  readonly tier: SubscriptionTier;
  readonly status: SubscriptionStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * Window in which a cancellation takes effect. Null while active or paused.
   * Cancellation is effective within one window, never retroactive.
   */
  readonly cancelEffectiveWindow: number | null;
  readonly audit: readonly SubscriptionAuditEntry[];
}
