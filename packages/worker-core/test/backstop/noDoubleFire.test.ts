import { describe, expect, it } from "vitest";
import {
  BackstopWatcher,
  InMemoryFireClaimStore,
  InMemoryInterventionRecorder,
  LATENCY_SENSITIVE_REJECTION,
  registerBackstop,
  type BackstopDeps,
  type WatchedSubscription,
  type FireDecision,
  type Intervention,
  type WindowVerdict,
} from "../../src/index.js";

const WINDOW: FireDecision = {
  windowId: "payroll-w1:ev-100",
  workerId: "payroll-w1",
  conditionEventId: "ev-100",
  conditionLedger: 100,
  deadlineLedger: 110,
};

const subscription: WatchedSubscription = {
  subscriptionId: "sub-1",
  workerId: "payroll-w1",
  tier: "time-insensitive",
  graceLedgers: 5,
};

function missed(over: Partial<WindowVerdict> = {}): WindowVerdict {
  return {
    windowId: WINDOW.windowId,
    workerId: WINDOW.workerId,
    verdict: "missed",
    conditionLedger: WINDOW.conditionLedger,
    deadlineLedger: WINDOW.deadlineLedger,
    ...over,
  };
}

type Harness = {
  watcher: BackstopWatcher;
  claims: InMemoryFireClaimStore;
  recorder: InMemoryInterventionRecorder;
  submitted: FireDecision[];
  notified: Intervention[];
};

function harness(
  verdict: WindowVerdict | undefined,
  over: Partial<{
    claims: InMemoryFireClaimStore;
    failSubmission: boolean;
    failNotify: boolean;
    subscription: WatchedSubscription;
  }> = {},
): Harness {
  const claims = over.claims ?? new InMemoryFireClaimStore();
  const recorder = new InMemoryInterventionRecorder();
  const submitted: FireDecision[] = [];
  const notified: Intervention[] = [];

  const deps: BackstopDeps = {
    verdicts: { verdictFor: () => verdict },
    claims,
    submitter: {
      submit: (decision) => {
        if (over.failSubmission) throw new Error("submission rejected by the network");
        submitted.push(decision);
      },
    },
    recorder,
    notifier: {
      notify: (intervention) => {
        if (over.failNotify) throw new Error("webhook unreachable");
        notified.push(intervention);
      },
    },
  };

  return {
    watcher: new BackstopWatcher(over.subscription ?? subscription, deps),
    claims,
    recorder,
    submitted,
    notified,
  };
}

describe("backstop registration", () => {
  it("refuses a latency-sensitive tier with a pointer to 22.4", () => {
    // The gate is what enforces "start with the cheap tier and earn your way to
    // the expensive one" (§C.7) — a warning would leave the subscription
    // running against guarantees W3 does not have.
    const result = registerBackstop({ ...subscription, tier: "latency-sensitive" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(" ")).toContain("22.4");
      expect(result.errors.join(" ")).toContain(LATENCY_SENSITIVE_REJECTION);
    }
  });

  it("accepts a time-insensitive tier", () => {
    expect(registerBackstop(subscription).ok).toBe(true);
  });

  it("requires a per-subscription grace period", () => {
    const result = registerBackstop({ ...subscription, graceLedgers: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("global constant");
  });
});

describe("the grace period", () => {
  it("waits until the primary's deadline plus this subscription's grace", async () => {
    const { watcher, submitted } = harness(missed());

    // deadline 110 + grace 5 = fires only after ledger 115
    for (const ledger of [110, 112, 115]) {
      const outcome = await watcher.evaluate(WINDOW, ledger);
      expect(outcome.kind).toBe("waiting");
      if (outcome.kind === "waiting") expect(outcome.firesAtLedger).toBe(115);
    }
    expect(submitted).toHaveLength(0);

    expect((await watcher.evaluate(WINDOW, 116)).kind).toBe("intervened");
  });

  it("derives the wait from the subscription, not a global constant", async () => {
    // Two subscriptions on the same window with different grace periods must
    // reach different decision points. A shared constant would either intervene
    // too early on the slow one or far too late on the fast one.
    const fast = harness(missed(), { subscription: { ...subscription, graceLedgers: 2 } });
    const slow = harness(missed(), { subscription: { ...subscription, graceLedgers: 1_000 } });

    const fastOutcome = await fast.watcher.evaluate(WINDOW, 500);
    const slowOutcome = await slow.watcher.evaluate(WINDOW, 500);

    expect(fastOutcome.kind).toBe("intervened");
    expect(slowOutcome.kind).toBe("waiting");
    if (slowOutcome.kind === "waiting") expect(slowOutcome.firesAtLedger).toBe(1_110);
  });
});

describe("no double-fire", () => {
  it("stands down when the primary fired inside the grace period", async () => {
    // The integration test the acceptance names. The primary fires late — after
    // its deadline but inside grace — and claims the window. The backstop then
    // reaches its own decision point and must not fire.
    const claims = new InMemoryFireClaimStore();
    const { watcher, submitted, recorder } = harness(missed(), { claims });

    // Primary fires late at ledger 113, claiming the shared window id.
    expect(claims.claim(WINDOW.windowId)).toBe(true);

    const outcome = await watcher.evaluate(WINDOW, 116);

    expect(outcome.kind).toBe("primary-won");
    expect(submitted).toHaveLength(0);
    expect(recorder.interventions).toHaveLength(0);
  });

  it("fires exactly once when two backstop processes watch the same window", async () => {
    // Two watchers sharing 18.6's store — the shape a redundant deployment
    // actually has.
    const claims = new InMemoryFireClaimStore();
    const a = harness(missed(), { claims });
    const b = harness(missed(), { claims });

    const [first, second] = await Promise.all([
      a.watcher.evaluate(WINDOW, 116),
      b.watcher.evaluate(WINDOW, 116),
    ]);

    const kinds = [first.kind, second.kind].sort();
    expect(kinds).toEqual(["intervened", "primary-won"]);
    expect(a.submitted.length + b.submitted.length).toBe(1);
  });

  it("does not re-fire a window it already intervened on", async () => {
    const claims = new InMemoryFireClaimStore();
    const { watcher, submitted } = harness(missed(), { claims });

    await watcher.evaluate(WINDOW, 116);
    const again = await watcher.evaluate(WINDOW, 130);

    expect(again.kind).toBe("primary-won");
    expect(submitted).toHaveLength(1);
  });
});

describe("it intervenes only on a definite miss", () => {
  it("does nothing when the primary fired late", async () => {
    // `late` means the contract call already happened. Firing again would be a
    // double payment, not a backstop.
    const { watcher, submitted } = harness(
      missed({ verdict: "late", firedLedger: 113, latencyLedgers: 3 }),
    );

    const outcome = await watcher.evaluate(WINDOW, 116);
    expect(outcome.kind).toBe("no-intervention");
    expect(submitted).toHaveLength(0);
  });

  it("does nothing on not-due, pending or unverifiable", async () => {
    for (const verdict of ["not-due", "pending", "unverifiable", "fired"] as const) {
      const { watcher, submitted } = harness(missed({ verdict }));
      expect((await watcher.evaluate(WINDOW, 116)).kind).toBe("no-intervention");
      expect(submitted).toHaveLength(0);
    }
  });

  it("does not invent a miss when verification knows nothing about the window", async () => {
    // Absence of a verdict is not evidence of a miss. Treating it as one is how
    // a backstop starts firing on windows verification never scored.
    const { watcher, submitted } = harness(undefined);

    const outcome = await watcher.evaluate(WINDOW, 116);
    expect(outcome.kind).toBe("no-intervention");
    if (outcome.kind === "no-intervention") expect(outcome.verdict.verdict).toBe("unverifiable");
    expect(submitted).toHaveLength(0);
  });
});

describe("interventions are recorded and notified", () => {
  it("records the intervention linked to the missed window's verdict", async () => {
    const verdict = missed();
    const { watcher, recorder } = harness(verdict);

    await watcher.evaluate(WINDOW, 116);

    expect(recorder.interventions).toHaveLength(1);
    const [intervention] = recorder.interventions;
    expect(intervention.windowId).toBe(WINDOW.windowId);
    expect(intervention.subscriptionId).toBe("sub-1");
    expect(intervention.cause).toBe("primary-missed");
    expect(intervention.verdict).toEqual(verdict);
    expect(intervention.primaryDeadlineLedger).toBe(110);
    expect(intervention.graceLedgers).toBe(5);
    expect(intervention.decidedAtLedger).toBe(116);
  });

  it("notifies the subscriber", async () => {
    const { watcher, notified } = harness(missed());
    await watcher.evaluate(WINDOW, 116);

    expect(notified).toHaveLength(1);
    expect(notified[0].windowId).toBe(WINDOW.windowId);
  });

  it("still reports success when notification fails", async () => {
    // A failed webhook does not un-fire the fallback, and must not turn a
    // successful intervention into a reported failure.
    const { watcher, recorder } = harness(missed(), { failNotify: true });

    const outcome = await watcher.evaluate(WINDOW, 116);
    expect(outcome.kind).toBe("intervened");
    expect(recorder.interventions).toHaveLength(1);
  });

  it("records the intervention even when submission fails", async () => {
    // The window is claimed and therefore closed to both parties. An operator
    // asking why nothing fired must find this rather than silence.
    const { watcher, recorder } = harness(missed(), { failSubmission: true });

    const outcome = await watcher.evaluate(WINDOW, 116);
    expect(outcome.kind).toBe("submission-failed");
    expect(recorder.interventions).toHaveLength(1);
  });
});

describe("readiness cost is measurable from day one (21.2)", () => {
  it("counts every window watched, not only the ones that failed", async () => {
    // The point of §C.7's economics: monitoring cost scales with subscriptions,
    // not with failures, so the counter that matters is windows watched.
    const { watcher } = harness(missed({ verdict: "fired" }));

    const windows: FireDecision[] = Array.from({ length: 5 }, (_, i) => ({
      ...WINDOW,
      windowId: `payroll-w1:ev-${i}`,
      conditionEventId: `ev-${i}`,
    }));

    await watcher.evaluateAll(windows, 116);

    expect(watcher.stats.windowsWatched).toBe(5);
    expect(watcher.stats.interventions).toBe(0);
    expect(watcher.stats.windowsNoIntervention).toBe(5);
  });

  it("separates waiting, stood-down and fired windows", async () => {
    const claims = new InMemoryFireClaimStore();
    const { watcher } = harness(missed(), { claims });

    await watcher.evaluate(WINDOW, 112); // waiting
    await watcher.evaluate(WINDOW, 116); // intervened
    await watcher.evaluate(WINDOW, 118); // already claimed

    expect(watcher.stats).toEqual({
      windowsWatched: 3,
      windowsWaiting: 1,
      windowsNoIntervention: 0,
      windowsPrimaryWon: 1,
      interventions: 1,
      submissionFailures: 0,
    });
  });
});
