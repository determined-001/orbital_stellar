import { describe, it, expect } from "vitest";
import {
  CoverageLedgerError,
  InMemoryCoverageLedger,
  assertValidCoverageWindow,
  coverageForWindow,
  isCoveredReason,
  wasCovered,
  type CoverageWindow,
} from "../../src/subscription/coverage.js";

const SUB = "sub-1";

function window(
  startLedger: number,
  endLedger: number,
  reason: CoverageWindow["reason"],
): CoverageWindow {
  return {
    subscriptionId: SUB,
    startLedger,
    endLedger,
    covered: isCoveredReason(reason),
    reason,
  };
}

describe("assertValidCoverageWindow", () => {
  it("rejects an empty window", () => {
    expect(() => assertValidCoverageWindow(window(100, 100, "active"))).toThrow(
      CoverageLedgerError,
    );
  });

  it("rejects a window whose covered flag contradicts its reason", () => {
    const lying: CoverageWindow = { ...window(100, 110, "lapsed"), covered: true };
    expect(() => assertValidCoverageWindow(lying)).toThrow(/cannot be recorded with covered=true/);
  });

  it("rejects a non-integer ledger", () => {
    expect(() => assertValidCoverageWindow(window(1.5, 10, "active"))).toThrow(CoverageLedgerError);
  });

  it("accepts grace as covered", () => {
    expect(() => assertValidCoverageWindow(window(100, 110, "grace"))).not.toThrow();
    expect(isCoveredReason("grace")).toBe(true);
  });
});

describe("InMemoryCoverageLedger", () => {
  it("is append-only: an overlapping window is refused, not merged", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));

    await expect(ledger.append(window(150, 250, "lapsed"))).rejects.toThrow(CoverageLedgerError);
    await expect(ledger.history(SUB)).resolves.toHaveLength(1);
  });

  it("does not hand out references a caller could mutate", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));

    const [stored] = await ledger.history(SUB);
    stored.covered = false;

    const found = await ledger.findAt(SUB, 150);
    expect(found?.covered).toBe(true);
  });

  it("answers 'was I covered at ledger N' as a lookup", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));
    await ledger.append(window(200, 260, "grace"));
    await ledger.append(window(260, 400, "lapsed"));

    await expect(wasCovered(ledger, SUB, 150)).resolves.toBe(true);
    await expect(wasCovered(ledger, SUB, 210)).resolves.toBe(true);
    await expect(wasCovered(ledger, SUB, 300)).resolves.toBe(false);
  });

  it("reports an unrecorded ledger as null, not as uncovered", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));

    await expect(wasCovered(ledger, SUB, 500)).resolves.toBeNull();
  });

  it("keeps records for other subscriptions separate", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));

    await expect(wasCovered(ledger, "sub-2", 150)).resolves.toBeNull();
  });
});

describe("coverageForWindow", () => {
  it("answers covered when every record spanning the window says so", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));

    await expect(coverageForWindow(ledger, SUB, 120, 180)).resolves.toBe("covered");
  });

  it("counts grace as covered", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "grace"));

    await expect(coverageForWindow(ledger, SUB, 100, 200)).resolves.toBe("covered");
  });

  it("answers uncovered after a lapse", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));
    await ledger.append(window(200, 400, "lapsed"));

    await expect(coverageForWindow(ledger, SUB, 200, 300)).resolves.toBe("uncovered");
  });

  it("answers partial when coverage changed inside the window", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "grace"));
    await ledger.append(window(200, 400, "lapsed"));

    await expect(coverageForWindow(ledger, SUB, 150, 250)).resolves.toBe("partial");
  });

  it("answers unknown for a gap in the record rather than assuming coverage", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));
    await ledger.append(window(300, 400, "active"));

    await expect(coverageForWindow(ledger, SUB, 150, 350)).resolves.toBe("unknown");
    await expect(coverageForWindow(ledger, SUB, 500, 600)).resolves.toBe("unknown");
  });

  it("answers unknown when the record stops short of the window end", async () => {
    const ledger = new InMemoryCoverageLedger();
    await ledger.append(window(100, 200, "active"));

    await expect(coverageForWindow(ledger, SUB, 150, 250)).resolves.toBe("unknown");
  });

  it("rejects an empty query window", async () => {
    const ledger = new InMemoryCoverageLedger();
    await expect(coverageForWindow(ledger, SUB, 200, 200)).rejects.toThrow(CoverageLedgerError);
  });
});
