/**
 * Billing hooks for backstop subscriptions (issue #1067, "21.6 Backstop
 * subscription lifecycle and billing hooks").
 *
 * Per `docs/open-source-policy.md`, open data and SDKs are MIT and the operated
 * service is the product. Billing glue is the operated side, so the
 * **interface** lives here and the **implementation** does not live in this
 * repository at all. No vendor SDK is a dependency of `worker-core`.
 *
 * This mirrors the metrics idiom already in `pulse-webhooks` (`metrics.ts` +
 * the Prometheus/OTel adapters): one interface, a no-op default, adapters
 * elsewhere. One idiom across the project.
 *
 * **No payment credentials pass through `worker-core`.** That is structural,
 * not a convention: the event shapes below carry a subscription id, a tier, a
 * ledger and a coverage window, and there is nowhere in them to put a card
 * token, a customer secret or an API key. The operated adapter resolves its own
 * customer mapping on its own side. `test/types.exhaustive.test-d.ts` fails the
 * build if a credential-shaped field is ever added.
 */

import type { CoverageWindow } from "./coverage.js";

/**
 * The facts the operated billing system reacts to. Nothing here returns money,
 * a card token or an invoice - only signals.
 *
 * `window` is the coverage record the transition just closed and wrote. It is
 * on the event so a billing adapter can reconcile a charge against the exact
 * stretch of ledgers it paid for, without a second read. It is `null` in
 * exactly one case - the first activation of a new subscription, where coverage
 * starts and nothing was closed. Reactivating a lapsed or cancelled
 * subscription closes the uncovered stretch, so it carries a window.
 */
export type SubscriptionEvent = {
  subscriptionId: string;
  tier: string;
  atLedger: number;
  window: CoverageWindow | null;
};

/**
 * Emitted when coverage is about to end, while the subscriber can still do
 * something about it. `lapsesAtLedger` is the ledger the subscription lapses
 * at if it is not renewed first - always in the future relative to `atLedger`.
 */
export type ExpiringSubscriptionEvent = SubscriptionEvent & {
  lapsesAtLedger: number;
};

/**
 * The hook surface. Every method is async and awaited by the lifecycle, so an
 * adapter can do real work; the coverage record and the state change are
 * already durable by the time a hook runs, so a hook that throws can never
 * leave a subscriber silently un-covered.
 */
export interface BillingHooks {
  onActivated(event: SubscriptionEvent): Promise<void>;
  onRenewed(event: SubscriptionEvent): Promise<void>;
  onExpiring(event: ExpiringSubscriptionEvent): Promise<void>;
  onLapsed(event: SubscriptionEvent): Promise<void>;
  onCancelled(event: SubscriptionEvent): Promise<void>;
}

/**
 * The default. An open-source user gets a working, unbilled backstop - billing
 * is something the operated service adds, not something the package requires.
 */
export const NOOP_BILLING_HOOKS: BillingHooks = {
  onActivated: async () => undefined,
  onRenewed: async () => undefined,
  onExpiring: async () => undefined,
  onLapsed: async () => undefined,
  onCancelled: async () => undefined,
};

/** One recorded hook call, in the order it was delivered. */
export type RecordedBillingCall =
  | { hook: "onActivated"; event: SubscriptionEvent }
  | { hook: "onRenewed"; event: SubscriptionEvent }
  | { hook: "onExpiring"; event: ExpiringSubscriptionEvent }
  | { hook: "onLapsed"; event: SubscriptionEvent }
  | { hook: "onCancelled"; event: SubscriptionEvent };

/**
 * An in-memory recorder, for tests and for a self-hoster who wants to see the
 * signal stream before wiring a real adapter. Mirrors
 * `CountingWebhookMetrics` in `pulse-webhooks`.
 */
export class RecordingBillingHooks implements BillingHooks {
  private readonly recorded: RecordedBillingCall[] = [];

  async onActivated(event: SubscriptionEvent): Promise<void> {
    this.recorded.push({ hook: "onActivated", event });
  }

  async onRenewed(event: SubscriptionEvent): Promise<void> {
    this.recorded.push({ hook: "onRenewed", event });
  }

  async onExpiring(event: ExpiringSubscriptionEvent): Promise<void> {
    this.recorded.push({ hook: "onExpiring", event });
  }

  async onLapsed(event: SubscriptionEvent): Promise<void> {
    this.recorded.push({ hook: "onLapsed", event });
  }

  async onCancelled(event: SubscriptionEvent): Promise<void> {
    this.recorded.push({ hook: "onCancelled", event });
  }

  /** Every call, in delivery order. */
  calls(): RecordedBillingCall[] {
    return [...this.recorded];
  }

  /** Just the hook names, in delivery order - the readable form for assertions. */
  hookNames(): Array<RecordedBillingCall["hook"]> {
    return this.recorded.map((c) => c.hook);
  }

  clear(): void {
    this.recorded.length = 0;
  }
}
