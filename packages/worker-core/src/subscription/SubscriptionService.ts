import { UrlValidator } from "@orbital-stellar/pulse-webhooks";

import { SubscriptionError } from "./errors.js";
import type { SubscriptionStore } from "./store.js";
import type {
  SubscriptionAction,
  SubscriptionAuditEntry,
  SubscriptionRecord,
  SubscriptionStatus,
  SubscriptionTier,
} from "./types.js";

/**
 * Tiers a subscription may actually be registered against.
 *
 * `latency-sensitive` is defined in the type but absent here on purpose: W3
 * ships the cheap tier only, so the expensive promise cannot be sold before
 * the infrastructure exists to keep it (21.3, which owns the tier definitions
 * themselves and the flag that gates them).
 */
const REGISTRABLE_TIERS: readonly SubscriptionTier[] = ["time-insensitive"];

export interface SubscriptionServiceOptions {
  store: SubscriptionStore;
  /**
   * SSRF guard for subscriber-supplied webhook targets. Defaults to
   * `pulse-webhooks`' own `UrlValidator` — subscriber-supplied URLs are the
   * classic SSRF vector and the guard already exists; a second implementation
   * would be the weaker one.
   */
  urlValidator?: Pick<UrlValidator, "validate">;
  /** Injectable clock, so the audit trail is testable. */
  now?: () => number;
  /** Injectable id generator. */
  newId?: () => string;
  /** The window index the service considers current. */
  currentWindow: () => number;
}

export interface CreateSubscriptionInput {
  subscriber: string;
  offering: string;
  webhookTarget: string;
  tier: SubscriptionTier;
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new SubscriptionError("INVALID_FIELD", `${field} must not be empty`);
  }
  return trimmed;
}

/**
 * Subscription lifecycle: create, pause, resume, cancel — each appending to an
 * append-only audit trail.
 *
 * The service holds no authority over subscriber funds and cannot acquire any:
 * there is no method here that takes a key, an allowance or a destination
 * address, and `SubscriptionRecord` has no field to store one. See
 * `test/subscription/noAuthority.test-d.ts`.
 */
export class SubscriptionService {
  private readonly store: SubscriptionStore;
  private readonly urlValidator: Pick<UrlValidator, "validate">;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly currentWindow: () => number;

  constructor(options: SubscriptionServiceOptions) {
    this.store = options.store;
    this.urlValidator = options.urlValidator ?? new UrlValidator();
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.currentWindow = options.currentWindow;
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const subscriber = requireNonEmpty(input.subscriber, "subscriber");
    const offering = requireNonEmpty(input.offering, "offering");
    const webhookTarget = requireNonEmpty(input.webhookTarget, "webhookTarget");

    if (!REGISTRABLE_TIERS.includes(input.tier)) {
      throw new SubscriptionError(
        "TIER_NOT_REGISTRABLE",
        `tier "${input.tier}" is not registrable yet — the latency-sensitive tier lands with 22.4, ` +
          `once the infrastructure exists to keep the guarantee it sells`,
      );
    }

    // Validated before anything is stored, not on delivery: a target that
    // fails the guard must never reach the retry queue in the first place.
    const rejection = await this.urlValidator.validate(webhookTarget);
    if (rejection !== null) {
      throw new SubscriptionError(
        "INVALID_WEBHOOK_TARGET",
        `webhook target rejected: ${rejection}`,
      );
    }

    const at = this.now();
    const record: SubscriptionRecord = {
      id: this.newId(),
      subscriber,
      offering,
      webhookTarget,
      tier: input.tier,
      status: "active",
      createdAt: at,
      updatedAt: at,
      cancelEffectiveWindow: null,
      audit: [this.entry("create", null, "active", at)],
    };
    await this.store.put(record);
    return record;
  }

  async pause(id: string, reason?: string): Promise<SubscriptionRecord> {
    return this.transition(id, "pause", "paused", ["active"], reason);
  }

  async resume(id: string, reason?: string): Promise<SubscriptionRecord> {
    return this.transition(id, "resume", "active", ["paused"], reason);
  }

  /**
   * Cancel. Takes effect in the **next** window, never retroactively, and the
   * window it takes effect in is recorded so "within one window" is a checkable
   * claim rather than a promise.
   */
  async cancel(id: string, reason?: string): Promise<SubscriptionRecord> {
    return this.transition(id, "cancel", "cancelled", ["active", "paused"], reason);
  }

  /** Every subscription belonging to one subscriber — 19.4's read path. */
  async listBySubscriber(subscriber: string): Promise<SubscriptionRecord[]> {
    return this.store.listBySubscriber(requireNonEmpty(subscriber, "subscriber"));
  }

  async get(id: string): Promise<SubscriptionRecord> {
    const record = await this.store.get(id);
    if (!record) {
      throw new SubscriptionError("NOT_FOUND", `subscription ${id} not found`);
    }
    return record;
  }

  private entry(
    action: SubscriptionAction,
    from: SubscriptionStatus | null,
    to: SubscriptionStatus,
    at: number,
    reason?: string,
  ): SubscriptionAuditEntry {
    return {
      action,
      at,
      from,
      to,
      window: this.currentWindow(),
      ...(reason ? { reason } : {}),
    };
  }

  private async transition(
    id: string,
    action: SubscriptionAction,
    to: SubscriptionStatus,
    allowedFrom: readonly SubscriptionStatus[],
    reason?: string,
  ): Promise<SubscriptionRecord> {
    const current = await this.get(id);

    if (current.status === "cancelled") {
      throw new SubscriptionError(
        "ALREADY_CANCELLED",
        `subscription ${id} is cancelled; cancellation is terminal`,
      );
    }
    if (!allowedFrom.includes(current.status)) {
      throw new SubscriptionError(
        "INVALID_TRANSITION",
        `cannot ${action} a subscription in state "${current.status}"`,
      );
    }

    const at = this.now();
    const updated: SubscriptionRecord = {
      ...current,
      status: to,
      updatedAt: at,
      cancelEffectiveWindow:
        to === "cancelled" ? this.currentWindow() + 1 : current.cancelEffectiveWindow,
      // Appended, never rewritten.
      audit: [...current.audit, this.entry(action, current.status, to, at, reason)],
    };
    await this.store.put(updated);
    return updated;
  }
}
