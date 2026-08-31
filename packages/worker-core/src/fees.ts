/**
 * Fee resolution for worker submissions.
 *
 * Simulation reports the resource fee an invocation needs *right now*. Ledger
 * contention can make the real cost higher by the time the transaction is
 * included, so operators pad it - and an unbounded pad is how an operator
 * drains its own XLM float on a congested ledger. Every fee here is therefore
 * both multiplied and capped, and the cap is configuration, not a constant.
 */

/** Default padding over the simulated resource fee. */
export const DEFAULT_FEE_MULTIPLIER = 1.5;

/** Highest multiplier the config will accept, whatever an operator asks for. */
export const MAX_FEE_MULTIPLIER = 10;

/** Default ceiling on the total fee, in stroops (1 XLM). */
export const DEFAULT_MAX_FEE_STROOPS = 10_000_000;

/** Classic base fee added on top of the resource fee, in stroops. */
export const BASE_FEE_STROOPS = 100;

export type FeeConfig = {
  /** Multiplier applied to the simulated resource fee. Defaults to {@link DEFAULT_FEE_MULTIPLIER}. */
  feeMultiplier?: number;
  /** Ceiling on the resulting total fee, in stroops. Defaults to {@link DEFAULT_MAX_FEE_STROOPS}. */
  maxFeeStroops?: number;
};

/** Thrown when the padded fee would exceed the operator's configured ceiling. */
export class FeeCapExceededError extends Error {
  constructor(
    readonly requestedStroops: number,
    readonly maxFeeStroops: number,
  ) {
    super(
      `[worker-core] fee ${requestedStroops} stroops exceeds the configured cap of ${maxFeeStroops}. ` +
        `Raise maxFeeStroops deliberately, or let the submission wait for a cheaper ledger.`,
    );
    this.name = "FeeCapExceededError";
  }
}

/** Thrown when a fee config is not usable, rather than silently clamped into range. */
export class InvalidFeeConfigError extends Error {
  constructor(message: string) {
    super(`[worker-core] ${message}`);
    this.name = "InvalidFeeConfigError";
  }
}

export type ResolvedFee = {
  /** Total fee to put on the transaction, in stroops. */
  totalStroops: number;
  /** The padded resource fee, before the classic base fee is added. */
  resourceFeeStroops: number;
  /** What simulation asked for, for logs and metrics. */
  simulatedResourceFeeStroops: number;
  multiplier: number;
};

/**
 * Turns simulation's `minResourceFee` into the fee to sign for.
 *
 * @throws {InvalidFeeConfigError} for a non-finite or out-of-range config, or a
 *   simulated fee that is not a usable number.
 * @throws {FeeCapExceededError} when the padded fee exceeds `maxFeeStroops`.
 */
export function resolveFee(
  simulatedResourceFee: string | number,
  config: FeeConfig = {},
): ResolvedFee {
  const simulated = Number(simulatedResourceFee);
  if (!Number.isFinite(simulated) || simulated < 0) {
    throw new InvalidFeeConfigError(
      `simulation returned an unusable minResourceFee: ${String(simulatedResourceFee)}`,
    );
  }

  const multiplier = config.feeMultiplier ?? DEFAULT_FEE_MULTIPLIER;
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new InvalidFeeConfigError(
      `feeMultiplier must be a finite number >= 1, got ${String(config.feeMultiplier)}`,
    );
  }
  if (multiplier > MAX_FEE_MULTIPLIER) {
    throw new InvalidFeeConfigError(
      `feeMultiplier ${multiplier} exceeds the hard ceiling of ${MAX_FEE_MULTIPLIER}`,
    );
  }

  const maxFeeStroops = config.maxFeeStroops ?? DEFAULT_MAX_FEE_STROOPS;
  if (!Number.isInteger(maxFeeStroops) || maxFeeStroops <= 0) {
    throw new InvalidFeeConfigError(
      `maxFeeStroops must be a positive integer, got ${String(config.maxFeeStroops)}`,
    );
  }

  const resourceFeeStroops = Math.ceil(simulated * multiplier);
  const totalStroops = resourceFeeStroops + BASE_FEE_STROOPS;

  if (totalStroops > maxFeeStroops) {
    throw new FeeCapExceededError(totalStroops, maxFeeStroops);
  }

  return {
    totalStroops,
    resourceFeeStroops,
    simulatedResourceFeeStroops: simulated,
    multiplier,
  };
}
