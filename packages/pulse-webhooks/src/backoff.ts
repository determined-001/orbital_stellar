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
 * Linear backoff with jitter.
 * Delay = attempt * 1000 * random()
 *
 * @example
 * attempt 1: 0 - 1000ms
 * attempt 2: 0 - 2000ms
 * attempt 3: 0 - 3000ms
 */
export const linear: BackoffStrategy = (attempt, rng) => {
  const linearDelay = attempt * 1000;
  return Math.floor(rng() * linearDelay);
};

/**
 * Capped exponential backoff with jitter.
 * Delay = min(2^(attempt-1) * 1000, 30000) * random()
 * Maximum delay capped at 30 seconds.
 *
 * @example
 * attempt 1: 0 - 1000ms
 * attempt 2: 0 - 2000ms
 * attempt 3: 0 - 4000ms
 * attempt 4: 0 - 8000ms
 * attempt 5: 0 - 16000ms
 * attempt 6+: 0 - 30000ms
 */
export const cappedExponential: BackoffStrategy = (attempt, rng) => {
  const exponentialDelay = Math.pow(2, attempt - 1) * 1000;
  const cappedDelay = Math.min(exponentialDelay, 30_000);
  return Math.floor(rng() * cappedDelay);
};

/**
 * Constant backoff with jitter.
 * Delay = 1000 * random()
 * All retries have the same base delay.
 *
 * @example
 * attempt 1: 0 - 1000ms
 * attempt 2: 0 - 1000ms
 * attempt 3: 0 - 1000ms
 */
export const constant: BackoffStrategy = (attempt, rng) => {
  const constantDelay = 1000;
  return Math.floor(rng() * constantDelay);
};
