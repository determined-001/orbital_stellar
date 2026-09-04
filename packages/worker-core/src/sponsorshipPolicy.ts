/**
 * Sponsorship policy for the fee-bump Paymaster.
 *
 * The policy answers a single question before the paymaster wraps any inner
 * transaction: **is this bump permitted right now?**
 *
 * Three independent spend-control axes are evaluated in order:
 *
 * 1. **Per-user rate limit** — at most `maxBumpsPerUserPerWindow` bumps in a
 *    rolling `windowMs` for a given user account.
 * 2. **Per-bump fee cap** — the requested `baseFee` (stroops) must not exceed
 *    `maxFeePerBump`.
 * 3. **Daily XLM ceiling** — the running daily total of XLM the operator has
 *    sponsored must remain below `dailyXlmCeiling`.
 *
 * Every axis that would block a bump raises a distinct, typed error so that
 * callers and alerting infrastructure can distinguish "rate-limited user" from
 * "fee too high" from "float exhausted" without parsing message strings.
 *
 * ## Float exhaustion
 *
 * Exceeding the daily XLM ceiling is treated as **loud failure**, not silent
 * drop. The paymaster raises {@link FloatExhaustedError} which callers MUST
 * surface to their alerting system. A quiet failure looks identical to a
 * worker miss from the outside and corrupts phase-19 reputation data.
 *
 * ## Clock injection
 *
 * All time-sensitive logic accepts an optional `now` parameter (milliseconds
 * since epoch). Pass a fixed value in tests to eliminate flakiness.
 */

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Raised when a user account has exceeded the per-window bump rate limit.
 * Retryable after `retryAfterMs` milliseconds.
 */
export class RateLimitedError extends Error {
  readonly name = "RateLimitedError" as const;
  constructor(
    public readonly userId: string,
    public readonly retryAfterMs: number,
  ) {
    super(`[paymaster] rate limit exceeded for account ${userId}. Retry after ${retryAfterMs}ms.`);
  }
}

/**
 * Raised when the requested base fee exceeds the configured per-bump ceiling.
 * The caller should reduce their requested fee or the operator should raise the
 * ceiling; this is never retryable as-is.
 */
export class FeeTooHighError extends Error {
  readonly name = "FeeTooHighError" as const;
  constructor(
    public readonly requestedFee: bigint,
    public readonly maxFee: bigint,
  ) {
    super(
      `[paymaster] requested base fee ${requestedFee} stroops exceeds max allowed ${maxFee} stroops.`,
    );
  }
}

/**
 * Raised when the operator's daily XLM sponsorship float has been exhausted.
 *
 * **This error must be surfaced to alerting.** A quiet failure looks
 * identical to a worker miss and corrupts phase-19 reputation data.
 */
export class FloatExhaustedError extends Error {
  readonly name = "FloatExhaustedError" as const;
  constructor(
    public readonly dailySpentXlm: number,
    public readonly ceilingXlm: number,
  ) {
    super(
      `[paymaster] daily XLM float exhausted: spent ${dailySpentXlm.toFixed(7)} XLM of ` +
        `${ceilingXlm.toFixed(7)} XLM ceiling. Operator must top up the paymaster account.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Policy configuration
// ---------------------------------------------------------------------------

export interface SponsorshipPolicyConfig {
  /**
   * Maximum number of fee bumps a single user account may receive within
   * `windowMs`. Defaults to 10.
   */
  maxBumpsPerUserPerWindow?: number;

  /**
   * Rolling window length in milliseconds for per-user rate limiting.
   * Defaults to 60_000 (one minute).
   */
  windowMs?: number;

  /**
   * Maximum base fee (in stroops) the paymaster will cover for a single bump.
   * Defaults to 10_000 stroops (0.001 XLM).
   */
  maxFeePerBump?: bigint;

  /**
   * Maximum total XLM the paymaster may sponsor in a single calendar day
   * (UTC). Defaults to 10 XLM. Must be finite and positive.
   *
   * When this ceiling is breached {@link FloatExhaustedError} is thrown and
   * the operator must top up or raise the ceiling.
   */
  dailyXlmCeiling?: number;
}

// Resolved defaults — all fields are required internally
interface ResolvedPolicy {
  maxBumpsPerUserPerWindow: number;
  windowMs: number;
  maxFeePerBump: bigint;
  dailyXlmCeiling: number;
}

const STROOP_PER_XLM = 10_000_000n;

function resolvePolicy(cfg: SponsorshipPolicyConfig): ResolvedPolicy {
  return {
    maxBumpsPerUserPerWindow: cfg.maxBumpsPerUserPerWindow ?? 10,
    windowMs: cfg.windowMs ?? 60_000,
    maxFeePerBump: cfg.maxFeePerBump ?? 10_000n,
    dailyXlmCeiling: cfg.dailyXlmCeiling ?? 10,
  };
}

// ---------------------------------------------------------------------------
// Per-user rate-limit bucket
// ---------------------------------------------------------------------------

interface UserBucket {
  /** Timestamps (ms) of recent bumps within the current window. */
  timestamps: number[];
}

// ---------------------------------------------------------------------------
// Daily spend tracker
// ---------------------------------------------------------------------------

interface DailySpend {
  /** UTC date string "YYYY-MM-DD" for the current window. */
  date: string;
  /** Cumulative stroops sponsored today. */
  stroops: bigint;
}

function utcDateString(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// SponsorshipPolicy
// ---------------------------------------------------------------------------

/**
 * Stateful sponsorship policy that enforces three spend-control axes.
 *
 * @example
 * const policy = new SponsorshipPolicy({
 *   maxBumpsPerUserPerWindow: 5,
 *   windowMs: 60_000,
 *   maxFeePerBump: 10_000n,
 *   dailyXlmCeiling: 100,
 * });
 *
 * // Before wrapping an inner transaction:
 * policy.check({ userId: innerTx.source, requestedBaseFee: 200n });
 *
 * // After a bump is confirmed submitted:
 * policy.record({ totalFeeStroops: 400n });
 */
export class SponsorshipPolicy {
  readonly #policy: ResolvedPolicy;
  readonly #buckets = new Map<string, UserBucket>();
  #daily: DailySpend = { date: "", stroops: 0n };

  constructor(config: SponsorshipPolicyConfig = {}) {
    this.#policy = resolvePolicy(config);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Checks all three spend-control axes.
   *
   * @throws {RateLimitedError} if the user has exceeded their per-window bump quota.
   * @throws {FeeTooHighError} if `requestedBaseFee` exceeds `maxFeePerBump`.
   * @throws {FloatExhaustedError} if today's cumulative XLM spend has hit the ceiling.
   */
  check(opts: { userId: string; requestedBaseFee: bigint }, nowMs = Date.now()): void {
    this.#checkRateLimit(opts.userId, nowMs);
    this.#checkFeeCap(opts.requestedBaseFee);
    this.#checkDailyFloat(nowMs);
  }

  /**
   * Records a successfully submitted bump so spend-control counters stay
   * accurate.
   *
   * Call this **after** the bump has been submitted to the network, not before,
   * so that a submission error doesn't consume a rate-limit slot.
   */
  record(opts: { userId: string; totalFeeStroops: bigint }, nowMs = Date.now()): void {
    this.#recordRateLimit(opts.userId, nowMs);
    this.#recordDailySpend(opts.totalFeeStroops, nowMs);
  }

  /**
   * Current daily XLM spend as a number (for health checks and metrics).
   */
  get dailySpentXlm(): number {
    return Number(this.#daily.stroops) / Number(STROOP_PER_XLM);
  }

  /**
   * Configured daily XLM ceiling.
   */
  get dailyXlmCeiling(): number {
    return this.#policy.dailyXlmCeiling;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #checkRateLimit(userId: string, nowMs: number): void {
    const bucket = this.#buckets.get(userId);
    if (!bucket) return; // no history → allowed

    const windowStart = nowMs - this.#policy.windowMs;
    const recent = bucket.timestamps.filter((t) => t > windowStart);

    if (recent.length >= this.#policy.maxBumpsPerUserPerWindow) {
      const oldestInWindow = recent[0]!;
      const retryAfterMs = oldestInWindow + this.#policy.windowMs - nowMs;
      throw new RateLimitedError(userId, Math.max(0, retryAfterMs));
    }
  }

  #checkFeeCap(requestedBaseFee: bigint): void {
    if (requestedBaseFee > this.#policy.maxFeePerBump) {
      throw new FeeTooHighError(requestedBaseFee, this.#policy.maxFeePerBump);
    }
  }

  #checkDailyFloat(nowMs: number): void {
    const today = utcDateString(nowMs);
    const stroops = this.#daily.date === today ? this.#daily.stroops : 0n;
    const spentXlm = Number(stroops) / Number(STROOP_PER_XLM);
    if (spentXlm >= this.#policy.dailyXlmCeiling) {
      throw new FloatExhaustedError(spentXlm, this.#policy.dailyXlmCeiling);
    }
  }

  #recordRateLimit(userId: string, nowMs: number): void {
    let bucket = this.#buckets.get(userId);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.#buckets.set(userId, bucket);
    }
    // Evict entries outside the window before pushing
    const windowStart = nowMs - this.#policy.windowMs;
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
    bucket.timestamps.push(nowMs);
  }

  #recordDailySpend(totalFeeStroops: bigint, nowMs: number): void {
    const today = utcDateString(nowMs);
    if (this.#daily.date !== today) {
      this.#daily = { date: today, stroops: 0n };
    }
    this.#daily.stroops += totalFeeStroops;
  }
}
