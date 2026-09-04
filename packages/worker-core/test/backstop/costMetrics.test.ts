import { describe, it, expect } from "vitest";
import {
  CompositeCostMeter,
  OtelCostMeter,
  PrometheusCostMeter,
  type Meter,
  type MetricAttributes,
} from "../../src/metrics.js";
import { InMemoryCostMeter } from "../../src/backstop/costMeter.js";

describe("PrometheusCostMeter", () => {
  it("exports attributed and standalone cost, labelled by subscription and driver", async () => {
    const meter = new PrometheusCostMeter();
    meter.recordRpcCall(["a", "b"], "getEvents", 30);
    meter.recordCompute("a", 5);

    const text = await meter.register().metrics();
    expect(text).toContain("orbital_backstop_cost_attributed_total");
    expect(text).toContain("orbital_backstop_cost_standalone_total");
    expect(text).toMatch(
      /orbital_backstop_cost_attributed_total\{subscription="a",driver="rpc_calls"\} 0\.5/,
    );
    expect(text).toMatch(
      /orbital_backstop_cost_standalone_total\{subscription="a",driver="rpc_calls"\} 1/,
    );
    expect(text).toMatch(
      /orbital_backstop_cost_attributed_total\{subscription="a",driver="compute_ms"\} 5/,
    );
  });

  it("splits a shared scan the same way the in-memory meter does", async () => {
    const prom = new PrometheusCostMeter();
    const mem = new InMemoryCostMeter(1000);
    prom.recordExportScan(["a", "b", "c", "d"], 4000);
    mem.recordExportScan(["a", "b", "c", "d"], 4000);

    const text = await prom.register().metrics();
    const [a] = mem.closeWindow(1060);
    expect(text).toMatch(
      /orbital_backstop_cost_attributed_total\{subscription="a",driver="export_scan_bytes"\} 1000/,
    );
    expect(a.attributedCost.exportScanBytes).toBe(1000);
  });

  it("accepts a shared registry so it scrapes alongside the other metrics", async () => {
    const { Registry } = await import("prom-client");
    const registry = new Registry();
    const meter = new PrometheusCostMeter(registry);
    meter.recordStorage("a", 128);

    expect(await registry.metrics()).toContain("orbital_backstop_cost_attributed_total");
    expect(meter.register()).toBe(registry);
  });
});

describe("OtelCostMeter", () => {
  function recordingMeter() {
    const calls: Array<{ name: string; value: number; attributes?: MetricAttributes }> = [];
    const meter: Meter = {
      createCounter: (name) => ({
        add: (value, attributes) => calls.push({ name, value, attributes }),
      }),
    };
    return { meter, calls };
  }

  it("takes any structurally compatible Meter, with no @opentelemetry/api dependency", () => {
    const { meter, calls } = recordingMeter();
    const cost = new OtelCostMeter(meter);
    cost.recordRpcCall(["a", "b"], "getEvents", 30);

    expect(calls).toContainEqual({
      name: "orbital.backstop.cost.attributed",
      value: 0.5,
      attributes: { subscription: "a", driver: "rpc_calls" },
    });
    expect(calls).toContainEqual({
      name: "orbital.backstop.cost.standalone",
      value: 1,
      attributes: { subscription: "a", driver: "rpc_calls" },
    });
  });

  it("records direct drivers without a split", () => {
    const { meter, calls } = recordingMeter();
    new OtelCostMeter(meter).recordCompute("a", 12);

    const attributed = calls.filter((c) => c.name === "orbital.backstop.cost.attributed");
    expect(attributed).toEqual([
      {
        name: "orbital.backstop.cost.attributed",
        value: 12,
        attributes: { subscription: "a", driver: "compute_ms" },
      },
    ]);
  });
});

describe("CompositeCostMeter", () => {
  it("feeds the exporter and the aggregator from one call site", async () => {
    // The expected deployment: an in-memory meter answers marginal-cost
    // questions, an exporter feeds the dashboard, and the watcher calls once.
    const prom = new PrometheusCostMeter();
    const mem = new InMemoryCostMeter(1000);
    const both = new CompositeCostMeter(prom, mem);

    both.recordRpcCall(["a", "b"], "getEvents", 20);
    both.recordCompute("a", 3);
    both.recordExportScan(["a"], 64);
    both.recordStorage("a", 16);

    const [a] = mem.closeWindow(1060);
    expect(a.attributedCost.rpcCalls).toBe(0.5);
    expect(a.attributedCost.computeMs).toBe(3);
    expect(await prom.register().metrics()).toMatch(
      /orbital_backstop_cost_attributed_total\{subscription="a",driver="rpc_calls"\} 0\.5/,
    );
  });
});
