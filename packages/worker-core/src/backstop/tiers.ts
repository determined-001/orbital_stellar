/**
 * Backstop tier configuration (issue #1071, "22.4 Latency-sensitive execution
 * path").
 *
 * §C.7: for copy-trading and liquidations, "late" means the opportunity is
 * gone, and catching the miss costs the same as running primary
 * infrastructure. The latency-sensitive tier is worth building only once its
 * cost is measured - promising a latency the infrastructure has not
 * demonstrated is exactly the mistake §C.7 warns against.
 *
 * NOTE ON SCOPE: this issue depends on #1064 ("21.3 Latency-tier
 * configuration, time-insensitive only") and #1070 ("22.3 Copy-trade worker
 * on the vault pattern"), both still open and unimplemented at the time this
 * file was written. There is no real tier-configuration system or vault
 * worker to extend yet. What follows is a standalone stub: the operational
 * safety rails the acceptance criteria ask for (a documented, reversible
 * enable decision; a hard requirement for a prior cost measurement), encoded
 * as types and a runtime guard, with the tier disabled by construction. It is
 * not wired into any real execution path - see `../hotPath/types.ts` for why.
 */

/**
 * A record that the tier's cost was actually measured (acceptance criterion:
 * "the tier's cost is measured through 21.2 before the tier is enabled").
 * 21.2 does not exist in this repo yet; this shape is a placeholder for
 * whatever that measurement produces, not the real thing.
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
 * The tier this repo ships today. Enabling it is not a matter of flipping
 * this flag in code - the flag itself is a placeholder until #1064's tier
 * configuration exists. It is here so a decision to enable is always visible
 * as a diff against a named, disabled default rather than materializing from
 * nothing.
 */
export const LATENCY_SENSITIVE_TIER_DEFAULT: TierEnableDecision = {
  enabled: false,
  decidedBy: "unset",
  decidedAt: "1970-01-01T00:00:00.000Z",
  rationale:
    "Default: disabled. No cost measurement exists yet (21.2 unimplemented), and the " +
    "infrastructure this tier depends on (21.3 tier configuration, 22.3 copy-trade " +
    "worker, this issue's own hot path) is not merged. See #1071, #1064, #1070.",
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
