import { beforeEach, describe, expect, it } from "vitest";

import {
  MemorySubscriptionStore,
  SubscriptionError,
  SubscriptionService,
} from "../../src/subscription/index.js";

const TARGET = "https://subscriber.example/hooks/worker";

let clock = 1_700_000_000_000;
let window = 7;
let ids = 0;

function service() {
  return new SubscriptionService({
    store: new MemorySubscriptionStore(),
    now: () => clock,
    newId: () => `sub-${++ids}`,
    currentWindow: () => window,
  });
}

beforeEach(() => {
  clock = 1_700_000_000_000;
  window = 7;
  ids = 0;
});

describe("registering a tier against a subscription", () => {
  it("refuses a disabled tier with a message naming 22.4", async () => {
    const svc = service();
    const err = await svc
      .create({
        subscriber: "s",
        offering: "payroll-30d",
        webhookTarget: TARGET,
        tier: "latency-sensitive",
      })
      .catch((e: unknown) => e as SubscriptionError);

    expect(err).toBeInstanceOf(SubscriptionError);
    expect(err.code).toBe("TIER_NOT_REGISTRABLE");
    expect(err.message).toContain("22.4");
  });

  it("attaches the tier to the subscription at version 1", async () => {
    const svc = service();
    const record = await svc.create({
      subscriber: "s",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
    });

    expect(record.tier).toBe("time-insensitive");
    expect(record.version).toBe(1);
    expect(record.audit[0]).toMatchObject({ version: 1, tier: "time-insensitive" });
  });
});

describe("a tier change is a new subscription version", () => {
  it("refuses a change to a disabled tier", async () => {
    const svc = service();
    const record = await svc.create({
      subscriber: "s",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
    });

    await expect(svc.changeTier(record.id, "latency-sensitive")).rejects.toMatchObject({
      code: "TIER_NOT_REGISTRABLE",
    });
    // Unchanged: a refused change must not bump the version either.
    const after = await svc.get(record.id);
    expect(after.version).toBe(1);
    expect(after.tier).toBe("time-insensitive");
  });

  it("refuses a change to the tier already in force", async () => {
    const svc = service();
    const record = await svc.create({
      subscriber: "s",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
    });

    await expect(svc.changeTier(record.id, "time-insensitive")).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("does not bump the version for a lifecycle transition", async () => {
    // pause/resume/cancel do not change what was promised, so they are not a
    // new version — only the tier is the guarantee.
    const svc = service();
    const record = await svc.create({
      subscriber: "s",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
    });

    const paused = await svc.pause(record.id);
    const resumed = await svc.resume(paused.id);
    expect(resumed.version).toBe(1);
    expect(resumed.audit.every((e) => e.version === 1)).toBe(true);
  });

  it("keeps the terms in force at a past window replayable from the record", async () => {
    // The property the versioning exists for: once a tier moves, "what was
    // promised in window 7" must still be answerable from the record alone,
    // or an SLO dispute becomes an argument about what it used to say.
    const svc = service();
    const record = await svc.create({
      subscriber: "s",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
    });

    const atWindow7 = record.audit.at(-1);
    expect(atWindow7).toMatchObject({ window: 7, version: 1, tier: "time-insensitive" });

    window = 40;
    const paused = await svc.pause(record.id, "audit trail check");
    expect(paused.audit.at(-1)).toMatchObject({ window: 40, version: 1 });

    // The original entry is untouched.
    expect(paused.audit[0]).toEqual(atWindow7);
  });
});
