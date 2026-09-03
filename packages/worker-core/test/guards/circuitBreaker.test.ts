import { describe, it, expect, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerNotOpenError,
  type GuardTripRecord,
} from "../../src/guards/circuitBreaker.js";

function trip(overrides: Partial<GuardTripRecord> = {}): GuardTripRecord {
  return {
    workerId: "w1",
    occurredAtUnix: 1_800_000_000,
    reason: "diverging",
    detail: { divergenceBps: 500 },
    ...overrides,
  };
}

describe("CircuitBreaker", () => {
  it("stays closed below the consecutive-trip threshold", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 3 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(false);
    expect(breaker.getState()).toEqual({ status: "closed", consecutiveTrips: 2 });
  });

  it("opens after N consecutive trips (a sustained manipulated-price attack)", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 3 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(true);
  });

  it("a success resets the consecutive counter, so intermittent trips never open it", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 3 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    breaker.recordSuccess();
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(false);
    expect(breaker.getState()).toEqual({ status: "closed", consecutiveTrips: 2 });
  });

  it("stays open on further trips - no automatic recovery", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 2 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(true);
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(true);
  });

  it("recordSuccess while open is a no-op - a single good reading does not self-heal the breaker", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 2 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    breaker.recordSuccess();
    expect(breaker.isOpen).toBe(true);
  });

  it("notifies onTrip for every trip, including while already open", () => {
    const onTrip = vi.fn();
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 2 }, onTrip);
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(onTrip).toHaveBeenCalledTimes(3);
  });

  it("records every trip on the scorecard, in order", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 5 });
    const first = trip({ reason: "stale" });
    const second = trip({ reason: "diverging" });
    breaker.recordTrip(first);
    breaker.recordTrip(second);
    expect(breaker.getTrips()).toEqual([first, second]);
  });

  it("manualReenable closes an open breaker and records who/when/why", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 2 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(true);

    breaker.manualReenable("ops-oncall", 1_800_001_000, "confirmed source outage resolved");

    expect(breaker.isOpen).toBe(false);
    expect(breaker.getState()).toEqual({ status: "closed", consecutiveTrips: 0 });
    expect(breaker.getReenables()).toEqual([
      {
        reenabledBy: "ops-oncall",
        reenabledAtUnix: 1_800_001_000,
        rationale: "confirmed source outage resolved",
      },
    ]);
  });

  it("manualReenable throws when the breaker is not open - there is nothing to re-enable", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 2 });
    expect(() => breaker.manualReenable("ops-oncall", 1_800_000_000, "n/a")).toThrow(
      CircuitBreakerNotOpenError,
    );
  });

  it("can trip, reopen, and trip again after a manual re-enable", () => {
    const breaker = new CircuitBreaker({ maxConsecutiveTrips: 2 });
    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(true);

    breaker.manualReenable("ops-oncall", 1_800_001_000, "resolved");
    expect(breaker.isOpen).toBe(false);

    breaker.recordTrip(trip());
    breaker.recordTrip(trip());
    expect(breaker.isOpen).toBe(true);
  });
});
