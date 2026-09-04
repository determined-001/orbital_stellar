import { UrlValidator } from "@orbital-stellar/pulse-webhooks";

import { registrableTiers, tierDefinition } from "../backstop/tiers.js";
import { SubscriptionError } from "./errors.js";
import type { SubscriptionStore } from "./store.js";
import type {
  SubscriptionAction,
  SubscriptionAuditEntry,
  SubscriptionRecord,
  SubscriptionStatus,
  SubscriptionTier,
} from "./types.js";

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

/**
 * Refuse a tier that is defined but disabled.
 *
 * The message names the issue that enables it, so the answer to "why can I not
 * register this" is in the error rather than in someone's memory — and so the
 * flag is visibly a safety device rather than something to flip for a demo.
 */
function assertRegistrable(tier: SubscriptionTier): void {
  if (registrableTiers().includes(tier)) return;
  const definition = tierDefinition(tier);
  throw new SubscriptionError(
    "TIER_NOT_REGISTRABLE",
    `tier "${tier}" is defined but not registrable: it is enabled by ${definition.enabledBy}, ` +
      `once the infrastructure exists to keep the guarantee it sells`,
  );
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

    assertRegistrable(input.tier);

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
      version: 1,
      audit: [this.entry("create", null, "active", at, 1, input.tier)],
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

  /**
   * Change the tier in force.
   *
   * A **new subscription version**, not an edit: the tier is the guarantee, and
   * what was promised over windows 10–40 has to stay answerable once the tier
   * moves, or an SLO dispute becomes an argument about what the record used to
   * say. The audit trail carries the version and tier of every entry, so the
   * terms in force at any past window can be replayed from the record alone.
   */
  async changeTier(
    id: string,
    tier: SubscriptionTier,
    reason?: string,
  ): Promise<SubscriptionRecord> {
    const current = await this.get(id);
    if (current.status === "cancelled") {
      throw new SubscriptionError(
        "ALREADY_CANCELLED",
        `subscription ${id} is cancelled; cancellation is terminal`,
      );
    }
    assertRegistrable(tier);

    if (tier === current.tier) {
      throw new SubscriptionError(
        "INVALID_TRANSITION",
        `subscription ${id} is already on tier "${tier}"`,
      );
    }

    const at = this.now();
    const version = current.version + 1;
    const updated: SubscriptionRecord = {
      ...current,
      tier,
      version,
      updatedAt: at,
      audit: [
        ...current.audit,
        this.entry("change-tier", current.status, current.status, at, version, tier, reason),
      ],
    };
    await this.store.put(updated);
    return updated;
  }

  private entry(
    action: SubscriptionAction,
    from: SubscriptionStatus | null,
    to: SubscriptionStatus,
    at: number,
    version: number,
    tier: SubscriptionTier,
    reason?: string,
  ): SubscriptionAuditEntry {
    return {
      action,
      version,
      tier,
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
      audit: [
        ...current.audit,
        this.entry(action, current.status, to, at, current.version, current.tier, reason),
      ],
    };
    await this.store.put(updated);
    return updated;
  }
}
