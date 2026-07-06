/**
 * BackoffStrategy defines the signature for retry delay calculation.
 *
 * @param attempt - The attempt number (1-indexed)
 * @param rng - A random number generator function returning [0, 1)
 * @returns The delay in milliseconds before the next retry
 */
export type BackoffStrategy = (attempt: number, rng: () => number) => number;

/**
 * Exponential backoff with jitter (default strategy).
 * Delay = 2^(attempt-1) * 1000 * random()
 *
 * @example
 * attempt 1: 0 - 1000ms
 * attempt 2: 0 - 2000ms
 * attempt 3: 0 - 4000ms
 */
export const exponentialJittered: BackoffStrategy = (attempt, rng) => {
  const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
  return Math.floor(rng() * exponentialDelay);
};

/**
 * Linear backoff.
 * Delay = attempt * 1000
 *
 * @example
 * attempt 1: 1000ms
 * attempt 2: 2000ms
 * attempt 3: 3000ms
 */
export const linear: BackoffStrategy = (attempt) => attempt * 1000;

/**
 * Capped exponential backoff.
 * Delay = min(2^(attempt-1) * 1000, 30000)
 * Maximum delay capped at 30 seconds.
 *
 * @example
 * attempt 1: 1000ms
 * attempt 2: 2000ms
 * attempt 3: 4000ms
 * attempt 4: 8000ms
 * attempt 5: 16000ms
 * attempt 6+: 30000ms
 */
export const cappedExponential: BackoffStrategy = (attempt) => {
  const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
  return Math.min(exponentialDelay, 30_000);
};

/**
 * Constant backoff.
 * Delay = 1000
 * All retries have the same base delay.
 *
 * @example
 * attempt 1: 1000ms
 * attempt 2: 1000ms
 * attempt 3: 1000ms
 */
export const constant: BackoffStrategy = () => 1000;
