import { describe, it, expect } from "vitest";
import {
  BackstopSubscription,
  LEGAL_TRANSITIONS,
  SubscriptionLifecycleError,
  isCoveredState,
  isLegalTransition,
  type SubscriptionState,
} from "../../src/subscription/lifecycle.js";
import {
  InMemoryCoverageLedger,
  coverageForWindow,
  wasCovered,
} from "../../src/subscription/coverage.js";
import { NOOP_BILLING_HOOKS, RecordingBillingHooks } from "../../src/subscription/billing.js";

const SUB = "sub-1";
const TIER = "standard";
const WINDOW = 60;

async function activate(atLedger = 1000) {
  const coverage = new InMemoryCoverageLedger();
  const hooks = new RecordingBillingHooks();
  const subscription = await BackstopSubscription.activate(
    { subscriptionId: SUB, tier: TIER, windowLedgers: WINDOW, coverage, hooks },
    atLedger,
  );
  return { subscription, coverage, hooks };
}

describe("the transition table", () => {
  it("has no path from active straight to lapsed", () => {
    expect(isLegalTransition("active", "lapsed")).toBe(false);
    expect(LEGAL_TRANSITIONS.active).not.toContain("lapsed");
  });

  it("makes expiring the only way into lapsed", () => {
    const states: SubscriptionState[] = ["active", "expiring", "lapsed", "cancelled"];
    const gateways = states.filter((s) => LEGAL_TRANSITIONS[s].includes("lapsed"));
    expect(gateways).toEqual(["expiring"]);
  });

  it("treats grace as covered and lapsed/cancelled as not", () => {
    expect(isCoveredState("active")).toBe(true);
    expect(isCoveredState("expiring")).toBe(true);
    expect(isCoveredState("lapsed")).toBe(false);
    expect(isCoveredState("cancelled")).toBe(false);
  });
});

describe("activate", () => {
  it("starts active and covered", async () => {
    const { subscription } = await activate();
    expect(subscription.state).toBe("active");
    expect(subscription.covered).toBe(true);
  });

  it("fires onActivated with no closed window", async () => {
    const { hooks } = await activate();
    const [call] = hooks.calls();
    expect(call.hook).toBe("onActivated");
    expect(call.event.window).toBeNull();
  });

  it("defaults to the no-op hooks", async () => {
    const coverage = new InMemoryCoverageLedger();
    const subscription = await BackstopSubscription.activate(
      { subscriptionId: SUB, tier: TIER, windowLedgers: WINDOW, coverage },
      1000,
    );
    await expect(subscription.cancel(1100)).resolves.toBeUndefined();
  });

  it("rejects a window size below one ledger", async () => {
    const coverage = new InMemoryCoverageLedger();
    await expect(
      BackstopSubscription.activate(
        { subscriptionId: SUB, tier: TIER, windowLedgers: 0, coverage },
        1000,
      ),
    ).rejects.toThrow(SubscriptionLifecycleError);
  });

  it("rejects a missing tier", async () => {
    const coverage = new InMemoryCoverageLedger();
    await expect(
      BackstopSubscription.activate(
        { subscriptionId: SUB, tier: "", windowLedgers: WINDOW, coverage },
        1000,
      ),
    ).rejects.toThrow(/tier is required/);
  });
});

describe("illegal transitions are enforced, not coerced", () => {
  it("refuses to lapse an active subscription", async () => {
    const { subscription } = await activate();
    await expect(subscription.lapse(1100)).rejects.toThrow(SubscriptionLifecycleError);
    expect(subscription.state).toBe("active");
  });

  it("refuses to renew a subscription that is not expiring", async () => {
    const { subscription } = await activate();
    await expect(subscription.renew(1100)).rejects.toThrow(/active -> active/);
  });

  it("refuses to cancel a lapsed subscription", async () => {
    const { subscription } = await activate();
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);
    await expect(subscription.cancel(1300)).rejects.toThrow(/lapsed -> cancelled/);
  });

  it("refuses a ledger that does not advance", async () => {
    const { subscription } = await activate(1000);
    await expect(subscription.beginExpiring(1000, 1100)).rejects.toThrow(/Ledger must advance/);
  });
});

describe("notify before the lapse, never after", () => {
  it("fires onExpiring before onLapsed", async () => {
    const { subscription, hooks } = await activate();
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);

    expect(hooks.hookNames()).toEqual(["onActivated", "onExpiring", "onLapsed"]);
  });

  it("puts the announced lapse ledger on the notification", async () => {
    const { subscription, hooks } = await activate();
    await subscription.beginExpiring(1100, 1200);

    const expiring = hooks.calls().find((c) => c.hook === "onExpiring");
    expect(expiring?.hook === "onExpiring" && expiring.event.lapsesAtLedger).toBe(1200);
    expect(subscription.lapsesAtLedger).toBe(1200);
  });

  it("refuses notice shorter than one window", async () => {
    const { subscription } = await activate();
    await expect(subscription.beginExpiring(1100, 1100 + WINDOW - 1)).rejects.toThrow(
      /at least one window/,
    );
    expect(subscription.state).toBe("active");
  });

  it("refuses to lapse earlier than the ledger the subscriber was told", async () => {
    const { subscription } = await activate();
    await subscription.beginExpiring(1100, 1200);

    await expect(subscription.lapse(1150)).rejects.toThrow(/cannot lapse at 1150/);
    expect(subscription.state).toBe("expiring");
    expect(subscription.covered).toBe(true);
  });

  it("keeps the subscriber covered through grace", async () => {
    const { subscription, coverage } = await activate();
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);

    await expect(wasCovered(coverage, SUB, 1150)).resolves.toBe(true);
  });

  it("clears the announced lapse on renewal", async () => {
    const { subscription, hooks } = await activate();
    await subscription.beginExpiring(1100, 1200);
    await subscription.renew(1150);

    expect(subscription.state).toBe("active");
    expect(subscription.lapsesAtLedger).toBeNull();
    expect(hooks.hookNames()).toEqual(["onActivated", "onExpiring", "onRenewed"]);
  });
});

describe("a lapsed subscription stops being backstopped within one window", () => {
  it("records the window after the lapse as uncovered", async () => {
    const { subscription, coverage } = await activate(1000);
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);
    // The watcher seals at the boundary of the window it just processed.
    await subscription.sealTo(1200 + WINDOW);

    await expect(coverageForWindow(coverage, SUB, 1200, 1200 + WINDOW)).resolves.toBe("uncovered");
  });

  it("leaves no covered ledger after the lapse ledger", async () => {
    const { subscription, coverage } = await activate(1000);
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);
    await subscription.sealTo(1400);

    await expect(wasCovered(coverage, SUB, 1199)).resolves.toBe(true);
    await expect(wasCovered(coverage, SUB, 1200)).resolves.toBe(false);
    await expect(wasCovered(coverage, SUB, 1399)).resolves.toBe(false);
  });
});

describe("the coverage record", () => {
  it("is written before the state moves", async () => {
    const coverage = new InMemoryCoverageLedger();
    const seen: string[] = [];
    const spy = {
      ...coverage,
      append: async (w: Parameters<typeof coverage.append>[0]) => {
        seen.push(`append:${w.reason}`);
        return coverage.append(w);
      },
      findAt: coverage.findAt.bind(coverage),
      history: coverage.history.bind(coverage),
    };

    const subscription = await BackstopSubscription.activate(
      { subscriptionId: SUB, tier: TIER, windowLedgers: WINDOW, coverage: spy },
      1000,
    );
    await subscription.cancel(1100);

    // The window written on cancellation describes the state being left, so the
    // record for the covered stretch exists before the subscription is not.
    expect(seen).toEqual(["append:active"]);
    await expect(wasCovered(coverage, SUB, 1050)).resolves.toBe(true);
  });

  it("stores the reason rather than deriving it later", async () => {
    const { subscription, coverage } = await activate(1000);
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);
    await subscription.sealTo(1300);

    const history = await coverage.history(SUB);
    expect(history.map((w) => [w.startLedger, w.endLedger, w.reason])).toEqual([
      [1000, 1100, "active"],
      [1100, 1200, "grace"],
      [1200, 1300, "lapsed"],
    ]);
  });

  it("stays answerable for a subscription that has since lapsed", async () => {
    const { subscription, coverage } = await activate(1000);
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);
    await subscription.sealTo(9000);

    await expect(coverageForWindow(coverage, SUB, 1000, 1100)).resolves.toBe("covered");
    await expect(coverageForWindow(coverage, SUB, 1050, 1150)).resolves.toBe("covered");
    await expect(coverageForWindow(coverage, SUB, 1150, 1250)).resolves.toBe("partial");
  });

  it("does not answer for a window the watcher has not sealed", async () => {
    const { subscription, coverage } = await activate(1000);
    await subscription.beginExpiring(1100, 1200);

    await expect(coverageForWindow(coverage, SUB, 1100, 1200)).resolves.toBe("unknown");
  });
});

describe("cancellation and reactivation", () => {
  it("cancels without grace and stops coverage at the cancel ledger", async () => {
    const { subscription, coverage, hooks } = await activate(1000);
    await subscription.cancel(1100);
    await subscription.sealTo(1200);

    expect(subscription.state).toBe("cancelled");
    expect(subscription.covered).toBe(false);
    expect(hooks.hookNames()).toEqual(["onActivated", "onCancelled"]);
    await expect(wasCovered(coverage, SUB, 1150)).resolves.toBe(false);
  });

  it("reactivates a lapsed subscription and closes the uncovered stretch", async () => {
    const { subscription, coverage, hooks } = await activate(1000);
    await subscription.beginExpiring(1100, 1200);
    await subscription.lapse(1200);
    await subscription.reactivate(1300);

    expect(subscription.state).toBe("active");
    expect(hooks.hookNames()).toEqual(["onActivated", "onExpiring", "onLapsed", "onActivated"]);

    const reactivation = hooks.calls().at(-1);
    expect(reactivation?.event.window).toMatchObject({
      startLedger: 1200,
      endLedger: 1300,
      covered: false,
      reason: "lapsed",
    });
    await expect(wasCovered(coverage, SUB, 1250)).resolves.toBe(false);
  });

  it("reactivates a cancelled subscription", async () => {
    const { subscription } = await activate(1000);
    await subscription.cancel(1100);
    await subscription.reactivate(1200);

    expect(subscription.state).toBe("active");
    expect(subscription.covered).toBe(true);
  });
});

describe("sealTo", () => {
  it("does not change state or fire a hook", async () => {
    const { subscription, hooks } = await activate(1000);
    await subscription.sealTo(1060);

    expect(subscription.state).toBe("active");
    expect(hooks.hookNames()).toEqual(["onActivated"]);
    expect(subscription.openLedger).toBe(1060);
  });

  it("lets successive windows be sealed without gaps or overlaps", async () => {
    const { subscription, coverage } = await activate(1000);
    await subscription.sealTo(1060);
    await subscription.sealTo(1120);
    await subscription.sealTo(1180);

    await expect(coverageForWindow(coverage, SUB, 1000, 1180)).resolves.toBe("covered");
    expect((await coverage.history(SUB)).length).toBe(3);
  });

  it("refuses to seal backwards", async () => {
    const { subscription } = await activate(1000);
    await subscription.sealTo(1060);
    await expect(subscription.sealTo(1030)).rejects.toThrow(/Ledger must advance/);
  });
});

describe("NOOP_BILLING_HOOKS", () => {
  it("resolves for every hook", async () => {
    const event = {
      subscriptionId: SUB,
      tier: TIER,
      atLedger: 1,
      window: null,
    };
    await expect(NOOP_BILLING_HOOKS.onActivated(event)).resolves.toBeUndefined();
    await expect(NOOP_BILLING_HOOKS.onRenewed(event)).resolves.toBeUndefined();
    await expect(
      NOOP_BILLING_HOOKS.onExpiring({ ...event, lapsesAtLedger: 2 }),
    ).resolves.toBeUndefined();
    await expect(NOOP_BILLING_HOOKS.onLapsed(event)).resolves.toBeUndefined();
    await expect(NOOP_BILLING_HOOKS.onCancelled(event)).resolves.toBeUndefined();
  });
});

describe("a failing billing hook cannot un-cover a subscriber", () => {
  it("leaves the state moved and the record written when a hook throws", async () => {
    const coverage = new InMemoryCoverageLedger();
    const subscription = await BackstopSubscription.activate(
      {
        subscriptionId: SUB,
        tier: TIER,
        windowLedgers: WINDOW,
        coverage,
        hooks: {
          ...NOOP_BILLING_HOOKS,
          onCancelled: async () => {
            throw new Error("billing vendor is down");
          },
        },
      },
      1000,
    );

    await expect(subscription.cancel(1100)).rejects.toThrow("billing vendor is down");
    expect(subscription.state).toBe("cancelled");
    await expect(wasCovered(coverage, SUB, 1050)).resolves.toBe(true);
  });
});
