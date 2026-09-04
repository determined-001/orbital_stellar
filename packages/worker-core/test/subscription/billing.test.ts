import { describe, it, expect } from "vitest";
import {
  NOOP_BILLING_HOOKS,
  RecordingBillingHooks,
  type SubscriptionEvent,
} from "../../src/subscription/billing.js";
import { BackstopSubscription } from "../../src/subscription/lifecycle.js";
import { InMemoryCoverageLedger } from "../../src/subscription/coverage.js";

const event: SubscriptionEvent = {
  subscriptionId: "sub-1",
  tier: "standard",
  atLedger: 1000,
  window: null,
};

describe("RecordingBillingHooks", () => {
  it("records calls in delivery order", async () => {
    const hooks = new RecordingBillingHooks();
    await hooks.onActivated(event);
    await hooks.onExpiring({ ...event, lapsesAtLedger: 1100 });
    await hooks.onLapsed(event);

    expect(hooks.hookNames()).toEqual(["onActivated", "onExpiring", "onLapsed"]);
  });

  it("does not hand out a list a caller can mutate", async () => {
    const hooks = new RecordingBillingHooks();
    await hooks.onRenewed(event);
    hooks.calls().pop();

    expect(hooks.calls()).toHaveLength(1);
  });

  it("clears", async () => {
    const hooks = new RecordingBillingHooks();
    await hooks.onCancelled(event);
    hooks.clear();

    expect(hooks.calls()).toEqual([]);
  });
});

describe("no payment credentials pass through worker-core", () => {
  it("emits events carrying only a subscription id, tier, ledger and window", async () => {
    const hooks = new RecordingBillingHooks();
    const subscription = await BackstopSubscription.activate(
      {
        subscriptionId: "sub-1",
        tier: "standard",
        windowLedgers: 60,
        coverage: new InMemoryCoverageLedger(),
        hooks,
      },
      1000,
    );
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);

    for (const call of hooks.calls()) {
      const keys = Object.keys(call.event).sort();
      const expected =
        call.hook === "onExpiring"
          ? ["atLedger", "lapsesAtLedger", "subscriptionId", "tier", "window"]
          : ["atLedger", "subscriptionId", "tier", "window"];
      expect(keys).toEqual(expected);
    }
  });

  it("ships no vendor billing dependency", async () => {
    const pkg = await import("../../package.json", { with: { type: "json" } });
    const deps = Object.keys(pkg.default.dependencies ?? {});
    for (const vendor of ["stripe", "braintree", "paddle", "lemonsqueezy", "chargebee"]) {
      expect(deps).not.toContain(vendor);
    }
  });
});

describe("NOOP_BILLING_HOOKS", () => {
  it("is the default an unbilled open-source deployment runs on", async () => {
    await expect(NOOP_BILLING_HOOKS.onLapsed(event)).resolves.toBeUndefined();
  });
});
