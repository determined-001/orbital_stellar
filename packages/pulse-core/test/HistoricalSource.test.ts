import { describe, it, expect } from "vitest";
import { RetentionBoundaryError } from "../src/HistoricalSource.js";

describe("RetentionBoundaryError", () => {
  it("names the requested ledger, the retention boundary, and the configured source", () => {
    const err = new RetentionBoundaryError({
      requestedLedger: 100,
      retentionBoundaryLedger: 500,
      configuredSource: "galexie",
    });

    expect(err.name).toBe("RetentionBoundaryError");
    expect(err.requestedLedger).toBe(100);
    expect(err.retentionBoundaryLedger).toBe(500);
    expect(err.configuredSource).toBe("galexie");
    expect(err.message).toContain("100");
    expect(err.message).toContain("500");
    expect(err.message).toContain("galexie");
  });

  it("names the boundary without a configured source when none is set", () => {
    const err = new RetentionBoundaryError({ requestedLedger: 100, retentionBoundaryLedger: 500 });

    expect(err.configuredSource).toBeUndefined();
    expect(err.message).toMatch(/no historical source is configured/);
  });
});
