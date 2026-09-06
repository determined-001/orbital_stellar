/**
 * Backstop latency tiers (issue #1064, "21.3 Latency-tier configuration,
 * time-insensitive only") and the enable decision that gates the expensive
 * one (issue #1071, "22.4 Latency-sensitive execution path").
 *
 * §C.7 requires pricing by latency tier rather than one flat fee, because the
 * two ends of that range are not the same promise. Payroll and periodic
 * settlement do not care whether a fallback fires an hour late — the guarantee
 * is cheap to make credibly. A trigger whose value evaporates in ninety
 * seconds is a different product with different infrastructure behind it: for
 * copy-trading and liquidations "late" means the opportunity is gone, and
 * catching the miss costs about what running primary infrastructure costs.
 *
 * W3 ships the **time-insensitive tier and nothing else.** The abstraction is
 * built to hold the latency-sensitive tier that 22.4 adds, but that tier ships
 * defined and disabled, so the expensive promise cannot be made before the
 * infrastructure exists to keep it.
 *
 * The disable is a **safety device, not a feature toggle.** It is not flipped
 * to demo the tier, to unblock a customer conversation, or to see what
 * happens. Enabling it is 22.4's job, and 22.4 is also the issue that lands
 * the monitoring the tier is measured against.
 *
 * **One switch, not two.** 22.4 landed its half of this file first, as a
 * standalone stub, while this issue was still open: a documented, reversible
 * {@link TierEnableDecision} requiring a prior {@link CostMeasurement}. That
 * stub is kept intact below, and the tier table now *derives*
 * `latency-sensitive`'s registrability from it — see
 * {@link LATENCY_SENSITIVE_TIER_DEFAULT}. There is deliberately no second
 * boolean that could be flipped on its own and disagree with the decision
 * record.
 */

/* -------------------------------------------------------------------------
 * The enable decision (22.4, #1071)
 * ---------------------------------------------------------------------- */

/**
 * A record that the tier's cost was actually measured (acceptance criterion:
 * "the tier's cost is measured through 21.2 before the tier is enabled").
 * 21.2 (#1063) does not exist in this repo yet; this shape is a placeholder
 * for whatever that measurement produces, not the real thing.
 */
export interface CostMeasurement {
  /** ISO 8601 timestamp the measurement was taken. */
  measuredAt: string;
  /** How many submissions the measurement is based on. */
  sampleCount: number;
  /** Median end-to-end latency observed, milliseconds. */
  medianLatencyMs: number;
  /** 99th-percentile end-to-end latency observed, milliseconds. */
  p99LatencyMs: number;
  /** Where the measurement came from - a scorecard id, a dashboard link, a report. */
  source: string;
}

/**
 * The operational decision to enable (or keep disabled) the latency-sensitive
 * tier (acceptance criterion: "Enabling the tier is a documented, reversible
 * operational decision"). `reversible` is a literal `true` so that a decision
 * object which claims to be irreversible cannot type-check - reversibility is
 * not optional for this tier.
 */
export interface TierEnableDecision {
  enabled: boolean;
  /** Who made this call - a person or team, not a process. */
  decidedBy: string;
  /** ISO 8601 timestamp of the decision. */
  decidedAt: string;
  /** Why, in prose - required even when `enabled` is false. */
  rationale: string;
  /** Required once `enabled` is true; see `assertTierEnableDecisionIsValid`. */
  costMeasurement?: CostMeasurement;
  reversible: true;
  /** Link to the review/sign-off record, if any. */
  reviewUrl?: string;
}

/**
 * The decision in force for the latency-sensitive tier today, and the **only**
 * switch that makes it registrable: {@link TIERS} reads `enabled` from here
 * rather than carrying a boolean of its own. A decision to enable is therefore
 * always visible as a diff against a named, disabled default rather than
 * materializing from nothing, and it cannot be made in one place and
 * contradicted in another.
 */
export const LATENCY_SENSITIVE_TIER_DEFAULT: TierEnableDecision = {
  enabled: false,
  decidedBy: "unset",
  decidedAt: "1970-01-01T00:00:00.000Z",
  rationale:
    "Default: disabled. No cost measurement exists yet (21.2 unimplemented), and the " +
    "infrastructure this tier depends on " +
    "is not merged. 21.3 tier configuration - this file's tier table - has landed. " +
    "See #1071, #1070, #1063.",
  reversible: true,
};

/**
 * Thrown by `assertTierEnableDecisionIsValid` when a decision claims to
 * enable the tier without the measurement §C.7 requires.
 */
export class TierEnableWithoutMeasurementError extends Error {
  constructor() {
    super(
      "Cannot enable the latency-sensitive tier without a costMeasurement. " +
        "Its cost must be measured through 21.2 before it is enabled (§C.7): " +
        "promising a latency the infrastructure has not demonstrated is the failure mode this guard exists to prevent.",
    );
    this.name = "TierEnableWithoutMeasurementError";
  }
}

/**
 * Runtime half of "enabling the tier is a documented, reversible operational
 * decision": a `TierEnableDecision` loaded from config (JSON, a database row)
 * is not type-checked, so this re-validates the constraints the type alone
 * cannot enforce outside authored TypeScript.
 */
export function assertTierEnableDecisionIsValid(decision: TierEnableDecision): void {
  if (decision.enabled && !decision.costMeasurement) {
    throw new TierEnableWithoutMeasurementError();
  }
}

/* -------------------------------------------------------------------------
 * The tier table (21.3, #1064)
 * ---------------------------------------------------------------------- */

/** Tier identifiers. Both are defined; only one is registrable (see below). */
export type TierId = "time-insensitive" | "latency-sensitive";

/**
 * The boundaries of a guarantee, in machine-readable form.
 *
 * Deliberately numbers rather than prose. 21.4's SLO monitoring has to assert
 * against the same values a subscriber was sold, and it cannot assert against
 * a sentence in a pricing page. Anything stated here is measurable; anything
 * not stated here is not guaranteed.
 */
export interface GuaranteeBounds {
  /**
   * How late a fire may be before the guarantee is breached, in milliseconds,
   * measured from the moment the trigger becomes due.
   */
  readonly latencyBoundMs: number;
  /**
   * Additional slack before a late fire counts against the SLO at all —
   * network jitter, ledger close variance, a queued transaction. Breach is
   * `latencyBoundMs + gracePeriodMs`.
   */
  readonly gracePeriodMs: number;
  /**
   * Conditions under which intervention is guaranteed. A backstop that fires
   * only when it can is not a guarantee, so the exclusions are stated as data
   * rather than being left to be argued after an incident.
   */
  readonly guaranteedWhen: {
    /** The subscription must be active — a paused one is not backstopped. */
    readonly subscriptionActive: true;
    /**
     * The contract call must be permissionless. The backstop holds no
     * authority and cannot fire a trigger that requires a signer — see the
     * worker layer's second rule.
     */
    readonly triggerPermissionless: true;
    /** Funds sufficient for the call must already be in place. */
    readonly fundsInPlace: true;
    /**
     * Ledger congestion above this multiple of baseline fees suspends the
     * guarantee. Stated, not implied: a backstop that promises to outbid an
     * arbitrary fee market is promising something it cannot deliver.
     */
    readonly maxFeeMultiplier: number;
  };
}

export interface TierDefinition {
  readonly id: TierId;
  readonly displayName: string;
  readonly description: string;
  readonly bounds: GuaranteeBounds;
  /**
   * Price per window, in stroops. An integer, because a price a subscriber is
   * billed against should not be a float.
   */
  readonly pricePerWindowStroops: bigint;
  /**
   * Whether this tier may be registered against a subscription **right now.**
   *
   * For `latency-sensitive` this is not an independent flag: it is
   * `LATENCY_SENSITIVE_TIER_DEFAULT.enabled`, revalidated. It is a safety
   * device, not a feature toggle. See the module comment.
   */
  readonly registrable: boolean;
  /** The issue that enables this tier, named in the refusal message. */
  readonly enabledBy: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Registrability of the expensive tier, read from 22.4's decision record and
 * revalidated on the way through — a decision that claims `enabled` without a
 * measurement throws here rather than quietly widening what may be sold.
 *
 * The cheap tier needs no such record: §C.7's point is that its guarantee is
 * cheap to make credibly, so there is nothing to measure before promising it.
 */
function latencySensitiveIsRegistrable(): boolean {
  assertTierEnableDecisionIsValid(LATENCY_SENSITIVE_TIER_DEFAULT);
  return LATENCY_SENSITIVE_TIER_DEFAULT.enabled;
}

export const TIERS: Readonly<Record<TierId, TierDefinition>> = {
  "time-insensitive": {
    id: "time-insensitive",
    displayName: "Time-insensitive",
    description:
      "Payroll and periodic settlement, where a fallback firing an hour late is a non-event. " +
      "The cheap tier, and the only one W3 ships.",
    bounds: {
      latencyBoundMs: 6 * HOUR,
      gracePeriodMs: 1 * HOUR,
      guaranteedWhen: {
        subscriptionActive: true,
        triggerPermissionless: true,
        fundsInPlace: true,
        maxFeeMultiplier: 10,
      },
    },
    pricePerWindowStroops: 10_000_000n, // 1 XLM
    registrable: true,
    enabledBy: "21.3",
  },
  "latency-sensitive": {
    id: "latency-sensitive",
    displayName: "Latency-sensitive",
    description:
      "Triggers whose value decays in minutes. Defined so the abstraction holds it, and " +
      "disabled until the infrastructure exists to keep the promise.",
    bounds: {
      latencyBoundMs: 2 * MINUTE,
      gracePeriodMs: 30_000,
      guaranteedWhen: {
        subscriptionActive: true,
        triggerPermissionless: true,
        fundsInPlace: true,
        maxFeeMultiplier: 100,
      },
    },
    pricePerWindowStroops: 500_000_000n, // 50 XLM
    registrable: latencySensitiveIsRegistrable(),
    enabledBy: "22.4",
  },
};

/** Tier ids a subscription may actually be registered against today. */
export function registrableTiers(): TierId[] {
  return (Object.keys(TIERS) as TierId[]).filter((id) => TIERS[id].registrable);
}

export function tierDefinition(id: TierId): TierDefinition {
  return TIERS[id];
}

/**
 * Whether a fire at `firedAt` met the tier's guarantee for a trigger that
 * became due at `dueAt`.
 *
 * Exists so 21.4 asserts against the same numbers the subscriber was sold,
 * from the same source, rather than reimplementing the arithmetic against a
 * pricing page.
 */
export function withinGuarantee(id: TierId, dueAt: number, firedAt: number): boolean {
  const { latencyBoundMs, gracePeriodMs } = TIERS[id].bounds;
  return firedAt - dueAt <= latencyBoundMs + gracePeriodMs;
}

/** The deadline a fire must beat for the guarantee to hold. */
export function guaranteeDeadline(id: TierId, dueAt: number): number {
  const { latencyBoundMs, gracePeriodMs } = TIERS[id].bounds;
  return dueAt + latencyBoundMs + gracePeriodMs;
}
