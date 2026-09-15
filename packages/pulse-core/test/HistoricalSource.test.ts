import { describe, it, expect, vi } from "vitest";
import {
  RpcHistoricalSource,
  OutOfRetentionError,
  isOutOfRetentionError,
  parseRetentionBoundary,
  withHistoricalFallback,
} from "../src/HistoricalSource.js";
import { SorobanRpcError } from "../src/errors.js";
import type { SorobanRpcLike, SorobanEvent } from "../src/SorobanSubscriber.js";

/**
 * The exact error shape Soroban RPC actually returns for an out-of-retention
 * `startLedger`, live-verified against https://soroban-testnet.stellar.org
 * on 2026-09-14 (see docs/design/long-range-replay.md §1):
 *   { code: -32600, message: "startLedger must be within the ledger range: 4558999 - 4679958" }
 * `SorobanRpcClient` classifies -32600 to `code: "invalid_request"` and
 * preserves the message verbatim - this is what a caller of `getEvents`
 * actually catches.
 */
function realOutOfRetentionError(oldest = 4558999, newest = 4679958): SorobanRpcError {
  return new SorobanRpcError(`startLedger must be within the ledger range: ${oldest} - ${newest}`, {
    code: "invalid_request",
    retryable: false,
  });
}

describe("isOutOfRetentionError / parseRetentionBoundary", () => {
  it("recognizes the real Soroban RPC out-of-retention error shape", () => {
    const err = realOutOfRetentionError();
    expect(isOutOfRetentionError(err)).toBe(true);
    expect(parseRetentionBoundary(err)).toBe(4558999);
  });

  it("does not misclassify an unrelated SorobanRpcError", () => {
    const err = new SorobanRpcError("rate limited", { code: "rate_limit", retryable: true });
    expect(isOutOfRetentionError(err)).toBe(false);
  });

  it("does not misclassify a plain Error or non-error value", () => {
    expect(isOutOfRetentionError(new Error("boom"))).toBe(false);
    expect(isOutOfRetentionError("boom")).toBe(false);
    expect(isOutOfRetentionError(null)).toBe(false);
  });

  it("parseRetentionBoundary returns undefined for a message that doesn't match", () => {
    const err = new SorobanRpcError("some other invalid_request", {
      code: "invalid_request",
      retryable: false,
    });
    expect(parseRetentionBoundary(err)).toBeUndefined();
  });
});

describe("RpcHistoricalSource", () => {
  function makeUnderlyingRpc(): SorobanRpcLike {
    return {
      getEvents: vi.fn(async () => ({ events: [] as SorobanEvent[] })),
      getLatestLedger: vi.fn(async () => 100),
    };
  }

  it("delegates getEvents to the wrapped rpc", async () => {
    const rpc = makeUnderlyingRpc();
    const source = new RpcHistoricalSource(rpc);
    await source.getEvents("cursor-1", 50);
    expect(rpc.getEvents).toHaveBeenCalledWith("cursor-1", 50);
  });

  it("covers() is true for every ledger when no earliestLedger was given", () => {
    const source = new RpcHistoricalSource(makeUnderlyingRpc());
    expect(source.covers(0)).toBe(true);
    expect(source.covers(1_000_000)).toBe(true);
  });

  it("covers() respects an explicit earliestLedger bound", () => {
    const source = new RpcHistoricalSource(makeUnderlyingRpc(), 1000);
    expect(source.covers(999)).toBe(false);
    expect(source.covers(1000)).toBe(true);
    expect(source.covers(5000)).toBe(true);
  });

  it("throws if the wrapped rpc has no getLatestLedger", async () => {
    const rpc: SorobanRpcLike = { getEvents: vi.fn(async () => ({ events: [] })) };
    const source = new RpcHistoricalSource(rpc);
    await expect(() => source.getLatestLedger()).rejects.toThrow(/no getLatestLedger/);
  });
});

describe("withHistoricalFallback", () => {
  it("delegates straight through to the primary rpc when no historicalSource is configured and it succeeds", async () => {
    const events = [{ id: "1-0", pagingToken: "1-0", topic: [], value: null }];
    const primary: SorobanRpcLike = { getEvents: vi.fn(async () => ({ events })) };
    const wrapped = withHistoricalFallback(primary, undefined, 100);
    const result = await wrapped.getEvents(undefined, 10);
    expect(result.events).toEqual(events);
  });

  it("still translates an out-of-retention error into an informative OutOfRetentionError with no historicalSource configured", async () => {
    const primary: SorobanRpcLike = {
      getEvents: vi.fn(async () => {
        throw realOutOfRetentionError();
      }),
    };
    const wrapped = withHistoricalFallback(primary, undefined, 100);

    await expect(wrapped.getEvents(undefined, 10)).rejects.toMatchObject({
      name: "OutOfRetentionError",
      requestedLedger: 100,
      retentionBoundaryLedger: 4558999,
      historicalSourceConfigured: false,
    });
  });

  it("uses the primary rpc directly when it succeeds", async () => {
    const events = [{ id: "1-0", pagingToken: "1-0", topic: [], value: null }];
    const primary: SorobanRpcLike = { getEvents: vi.fn(async () => ({ events })) };
    const historical = { covers: vi.fn(), getEvents: vi.fn() };

    const wrapped = withHistoricalFallback(primary, historical, 100);
    const result = await wrapped.getEvents(undefined, 10);

    expect(result.events).toEqual(events);
    expect(historical.getEvents).not.toHaveBeenCalled();
  });

  it("falls back to the historical source when the primary reports out-of-retention and it covers startLedger", async () => {
    const primary: SorobanRpcLike = {
      getEvents: vi.fn(async () => {
        throw realOutOfRetentionError();
      }),
    };
    const historicalEvents = [{ id: "100-0", pagingToken: "100-0", topic: [], value: null }];
    const historical = {
      covers: vi.fn(() => true),
      getEvents: vi.fn(async () => ({ events: historicalEvents })),
    };

    const wrapped = withHistoricalFallback(primary, historical, 100);
    const result = await wrapped.getEvents(undefined, 10);

    expect(result.events).toEqual(historicalEvents);
    expect(historical.covers).toHaveBeenCalledWith(100);
  });

  it("stays on the historical source for subsequent calls once it has fallen back", async () => {
    let primaryCalls = 0;
    const primary: SorobanRpcLike = {
      getEvents: vi.fn(async () => {
        primaryCalls++;
        throw realOutOfRetentionError();
      }),
    };
    const historical = {
      covers: vi.fn(() => true),
      getEvents: vi.fn(async () => ({ events: [] })),
    };

    const wrapped = withHistoricalFallback(primary, historical, 100);
    await wrapped.getEvents(undefined, 10);
    await wrapped.getEvents("cursor-2", 10);
    await wrapped.getEvents("cursor-3", 10);

    expect(primaryCalls).toBe(1);
    expect(historical.getEvents).toHaveBeenCalledTimes(3);
  });

  it("throws OutOfRetentionError naming the parsed boundary when the historical source does not cover startLedger", async () => {
    const primary: SorobanRpcLike = {
      getEvents: vi.fn(async () => {
        throw realOutOfRetentionError();
      }),
    };
    const historical = { covers: vi.fn(() => false), getEvents: vi.fn() };

    const wrapped = withHistoricalFallback(primary, historical, 100);

    await expect(wrapped.getEvents(undefined, 10)).rejects.toMatchObject({
      name: "OutOfRetentionError",
      requestedLedger: 100,
      retentionBoundaryLedger: 4558999,
      historicalSourceConfigured: true,
    });
  });

  it("throws OutOfRetentionError when the historical source itself fails", async () => {
    const primary: SorobanRpcLike = {
      getEvents: vi.fn(async () => {
        throw realOutOfRetentionError();
      }),
    };
    const historical = {
      covers: vi.fn(() => true),
      getEvents: vi.fn(async () => {
        throw new Error("historical source unreachable");
      }),
    };

    const wrapped = withHistoricalFallback(primary, historical, 100);
    await expect(wrapped.getEvents(undefined, 10)).rejects.toBeInstanceOf(OutOfRetentionError);
  });

  it("re-throws an unrelated error without attempting fallback", async () => {
    const rateLimitError = new SorobanRpcError("rate limited", {
      code: "rate_limit",
      retryable: true,
    });
    const primary: SorobanRpcLike = {
      getEvents: vi.fn(async () => {
        throw rateLimitError;
      }),
    };
    const historical = { covers: vi.fn(), getEvents: vi.fn() };

    const wrapped = withHistoricalFallback(primary, historical, 100);
    await expect(wrapped.getEvents(undefined, 10)).rejects.toBe(rateLimitError);
    expect(historical.covers).not.toHaveBeenCalled();
  });
});

describe("OutOfRetentionError", () => {
  it("names the boundary and historical-source configuration in its message", () => {
    const withSource = new OutOfRetentionError(100, 4558999, true);
    expect(withSource.message).toContain("4558999");
    expect(withSource.message).toContain("could not serve it either");

    const withoutSource = new OutOfRetentionError(100, 4558999, false);
    expect(withoutSource.message).toContain("no historical source is configured");
  });

  it("degrades to an honest 'could not be parsed' message when the boundary is unknown", () => {
    const err = new OutOfRetentionError(100, undefined, true);
    expect(err.message).toContain("could not be parsed");
    expect(err.retentionBoundaryLedger).toBeUndefined();
  });
});
