/**
 * Guard-trip circuit breaker (issue #1072, "22.5 Slippage and oracle guard
 * rails"). Halts a worker after N consecutive guard trips and requires a
 * human to re-enable it - see implementation note 2: an automatic reset
 * re-enters the same condition that tripped the breaker, so the friction is
 * deliberate, not an oversight to smooth away.
 */

/** One guard failure, worth recording regardless of whether it opened the breaker. */
export interface GuardTripRecord {
  workerId: string;
  occurredAtUnix: number;
  /** Machine-readable trip reason, e.g. a `PriceGuardVerdict["reason"]`. */
  reason: string;
  /** The verdict (or other guard output) that caused the trip, for the scorecard. */
  detail: unknown;
}

/** Audit record of a manual re-enable - who, when, why. */
export interface ReenableRecord {
  reenabledBy: string;
  reenabledAtUnix: number;
  rationale: string;
}

export type CircuitBreakerState =
  | { status: "closed"; consecutiveTrips: number }
  | { status: "open"; trippedAtUnix: number; trippingTrips: readonly GuardTripRecord[] };

export interface CircuitBreakerConfig {
  /** Trip and hold open after this many *consecutive* guard failures. */
  maxConsecutiveTrips: number;
}

/**
 * Thrown by `manualReenable` when the breaker isn't open - there is nothing
 * to re-enable, and silently no-op-ing would hide a caller's wrong
 * assumption about the breaker's state.
 */
export class CircuitBreakerNotOpenError extends Error {
  constructor() {
    super("Circuit breaker is not open; there is nothing to re-enable.");
    this.name = "CircuitBreakerNotOpenError";
  }
}

/**
 * Per-worker guard circuit breaker. Every guard trip is recorded and handed
 * to `onTrip` (the "notified" half of "recorded, notified and visible on the
 * scorecard" - `onTrip` is where a real implementation would publish to the
 * scorecard and page an operator); the "visible on the scorecard" half is
 * `getTrips()`, the append-only record this class keeps.
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly onTrip?: (record: GuardTripRecord) => void;
  private state: CircuitBreakerState = { status: "closed", consecutiveTrips: 0 };
  private readonly trips: GuardTripRecord[] = [];
  private readonly reenables: ReenableRecord[] = [];

  constructor(config: CircuitBreakerConfig, onTrip?: (record: GuardTripRecord) => void) {
    this.config = config;
    this.onTrip = onTrip;
  }

  get isOpen(): boolean {
    return this.state.status === "open";
  }

  getState(): CircuitBreakerState {
    return this.state;
  }

  getTrips(): readonly GuardTripRecord[] {
    return this.trips;
  }

  getReenables(): readonly ReenableRecord[] {
    return this.reenables;
  }

  /**
   * Records a guard failure. Once open, the breaker stays open and further
   * trips are still recorded (for the scorecard) but do not change state -
   * only `manualReenable` closes it again.
   */
  recordTrip(record: GuardTripRecord): CircuitBreakerState {
    this.trips.push(record);
    this.onTrip?.(record);

    if (this.state.status === "open") {
      this.state = {
        ...this.state,
        trippingTrips: this.trips.slice(-this.config.maxConsecutiveTrips),
      };
      return this.state;
    }

    const consecutiveTrips = this.state.consecutiveTrips + 1;
    if (consecutiveTrips >= this.config.maxConsecutiveTrips) {
      this.state = {
        status: "open",
        trippedAtUnix: record.occurredAtUnix,
        trippingTrips: this.trips.slice(-this.config.maxConsecutiveTrips),
      };
    } else {
      this.state = { status: "closed", consecutiveTrips };
    }
    return this.state;
  }

  /**
   * Records a clean (non-tripped) guard check, resetting the consecutive
   * counter. Only meaningful while closed - a success recorded while open is
   * a no-op, because the breaker does not self-heal on a single good reading;
   * see `manualReenable`.
   */
  recordSuccess(): CircuitBreakerState {
    if (this.state.status === "closed") {
      this.state = { status: "closed", consecutiveTrips: 0 };
    }
    return this.state;
  }

  /**
   * The only way to close an open breaker. Deliberate friction (implementation
   * note 2): an automatic reset would re-enter the same condition that
   * tripped it, so a human must look at `getTrips()` and decide.
   */
  manualReenable(
    reenabledBy: string,
    reenabledAtUnix: number,
    rationale: string,
  ): CircuitBreakerState {
    if (this.state.status !== "open") {
      throw new CircuitBreakerNotOpenError();
    }
    this.reenables.push({ reenabledBy, reenabledAtUnix, rationale });
    this.state = { status: "closed", consecutiveTrips: 0 };
    return this.state;
  }
}
