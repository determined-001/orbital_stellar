import { describe, it, expect } from "vitest";
import {
  CostMeterError,
  InMemoryCostMeter,
  NOOP_COST_METER,
  emptyCostBreakdown,
} from "../../src/backstop/costMeter.js";

describe("per-subscription attribution", () => {
  it("meters all four drivers §C.7 names", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.recordRpcCall(["a"], "getEvents", 40);
    meter.recordExportScan(["a"], 2048);
    meter.recordCompute("a", 7);
    meter.recordStorage("a", 512);

    const [w] = meter.closeWindow(1060);
    expect(w.attributedCost).toEqual({
      rpcCalls: 1,
      rpcMs: 40,
      exportScans: 1,
      exportScanBytes: 2048,
      computeMs: 7,
      storageByteLedgers: 512,
    });
  });

  it("splits a shared call evenly, so attributed cost sums to spend incurred", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.track("b", "contract-x");
    meter.track("c", "contract-x");
    meter.recordRpcCall(["a", "b", "c"], "getEvents", 30);

    const windows = meter.closeWindow(1060);
    const totalCalls = windows.reduce((n, w) => n + w.attributedCost.rpcCalls, 0);
    const totalMs = windows.reduce((n, w) => n + w.attributedCost.rpcMs, 0);

    // One call actually happened. The attributed total is one call, not three.
    expect(totalCalls).toBeCloseTo(1, 10);
    expect(totalMs).toBeCloseTo(30, 10);
  });

  it("records what each subscription would have cost alone, alongside the split", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.track("b", "contract-x");
    meter.recordRpcCall(["a", "b"], "getEvents", 30);

    const [a] = meter.closeWindow(1060);
    expect(a.attributedCost.rpcCalls).toBeCloseTo(0.5, 10);
    expect(a.standaloneCost.rpcCalls).toBe(1);
  });

  it("does not double-count a subscription named twice in one call", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.recordRpcCall(["a", "a"], "getEvents", 10);

    const [a] = meter.closeWindow(1060);
    expect(a.attributedCost.rpcCalls).toBe(1);
    expect(a.standaloneCost.rpcCalls).toBe(1);
  });

  it("refuses a shared cost with no subscription to attribute it to", () => {
    const meter = new InMemoryCostMeter(1000);
    expect(() => meter.recordRpcCall([], "getEvents", 10)).toThrow(CostMeterError);
  });

  it("refuses a negative measurement", () => {
    const meter = new InMemoryCostMeter(1000);
    expect(() => meter.recordCompute("a", -1)).toThrow(/non-negative/);
  });
});

describe("windows", () => {
  it("buckets cost into windows that line up with coverage windows", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.recordCompute("a", 5);
    meter.closeWindow(1060);
    meter.recordCompute("a", 9);
    meter.closeWindow(1120);

    const buckets = meter
      .history("a")
      .map((w) => [w.startLedger, w.endLedger, w.attributedCost.computeMs]);
    expect(buckets).toEqual([
      [1000, 1060, 5],
      [1060, 1120, 9],
    ]);
  });

  it("records a zero-cost window for a tracked subscription that cost nothing", () => {
    // Omitting it would bias every per-subscription mean upwards.
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.track("b", "contract-x");
    meter.recordCompute("a", 5);

    const windows = meter.closeWindow(1060);
    expect(windows.map((w) => w.subscriptionId)).toEqual(["a", "b"]);
    expect(windows[1].attributedCost).toEqual(emptyCostBreakdown());
  });

  it("refuses to close a window backwards", () => {
    const meter = new InMemoryCostMeter(1000);
    expect(() => meter.closeWindow(900)).toThrow(/must advance/);
  });

  it("does not hand out records a caller could mutate", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.recordCompute("a", 5);
    meter.closeWindow(1060);

    meter.history("a")[0].attributedCost.computeMs = 999;
    expect(meter.history("a")[0].attributedCost.computeMs).toBe(5);
  });
});

describe("sharing factor", () => {
  it("reports the value of shared monitoring as a number", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.track("b", "contract-x");
    meter.track("c", "contract-x");
    meter.recordRpcCall(["a", "b", "c"], "getEvents", 30);
    meter.closeWindow(1060);

    // Three subscriptions on one call: each would have made the call alone.
    expect(meter.sharingFactor(1000).rpcCalls).toBeCloseTo(3, 10);
  });

  it("reports 1 for a driver with no cost rather than dividing by zero", () => {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.closeWindow(1060);

    expect(meter.sharingFactor(1000).rpcCalls).toBe(1);
  });

  it("counts distinct conditions, which is what sharing acts on", () => {
    const meter = new InMemoryCostMeter(1000);
    expect(meter.track("a", "contract-x")).toBe("new-condition");
    expect(meter.track("b", "contract-x")).toBe("shared-condition");
    expect(meter.track("c", "contract-y")).toBe("new-condition");

    expect(meter.activeCount).toBe(3);
    expect(meter.conditionCount).toBe(2);
  });
});

describe("marginal cost", () => {
  function meterWithBaseline() {
    const meter = new InMemoryCostMeter(1000);
    meter.track("a", "contract-x");
    meter.recordRpcCall(["a"], "getEvents", 10);
    meter.recordCompute("a", 4);
    meter.closeWindow(1060);
    return meter;
  }

  it("reports adding to a watched condition separately from opening a new one", () => {
    const meter = meterWithBaseline();

    // Window 2: "b" joins "a" on the same condition — one call still serves both.
    meter.track("b", "contract-x");
    meter.recordRpcCall(["a", "b"], "getEvents", 10);
    meter.recordCompute("a", 4);
    meter.recordCompute("b", 4);
    meter.closeWindow(1120);

    // Window 3: "c" brings a condition nobody was watching — a second call.
    meter.track("c", "contract-y");
    meter.recordRpcCall(["a", "b"], "getEvents", 10);
    meter.recordRpcCall(["c"], "getEvents", 10);
    meter.recordCompute("a", 4);
    meter.recordCompute("b", 4);
    meter.recordCompute("c", 4);
    meter.closeWindow(1180);

    const report = meter.marginalCost();
    expect(report.sharedCondition?.samples).toBe(1);
    expect(report.newCondition?.samples).toBe(1);

    // The whole point of splitting them: joining a cohort costs no extra RPC,
    // opening a condition costs a whole one.
    expect(report.sharedCondition?.perSubscription.rpcCalls).toBeCloseTo(0, 10);
    expect(report.newCondition?.perSubscription.rpcCalls).toBeCloseTo(1, 10);
  });

  it("skips a window that added both kinds rather than blending them", () => {
    const meter = meterWithBaseline();
    meter.track("b", "contract-x");
    meter.track("c", "contract-y");
    meter.recordCompute("a", 4);
    meter.closeWindow(1120);

    const report = meter.marginalCost();
    expect(report.transitionsSkippedMixed).toBe(1);
    expect(report.sharedCondition).toBeNull();
    expect(report.newCondition).toBeNull();
  });

  it("skips a window where the subscription count did not change", () => {
    const meter = meterWithBaseline();
    meter.recordCompute("a", 4);
    meter.closeWindow(1120);

    const report = meter.marginalCost();
    expect(report.transitionsObserved).toBe(1);
    expect(report.transitionsSkippedFlat).toBe(1);
  });

  it("reports null rather than a number when nothing has been measured", () => {
    // The criterion is "measured numbers, not estimates". No data, no figure.
    const meter = new InMemoryCostMeter(1000);
    const report = meter.marginalCost();
    expect(report.sharedCondition).toBeNull();
    expect(report.newCondition).toBeNull();
    expect(report.transitionsObserved).toBe(0);
  });
});

describe("NOOP_COST_METER", () => {
  it("is the default and records nothing", () => {
    expect(() => {
      NOOP_COST_METER.recordRpcCall(["a"], "getEvents", 1);
      NOOP_COST_METER.recordExportScan(["a"], 1);
      NOOP_COST_METER.recordCompute("a", 1);
      NOOP_COST_METER.recordStorage("a", 1);
    }).not.toThrow();
  });
});
