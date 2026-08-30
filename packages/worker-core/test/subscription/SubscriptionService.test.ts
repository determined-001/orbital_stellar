import { beforeEach, describe, expect, it } from "vitest";

import {
  MemorySubscriptionStore,
  SubscriptionError,
  SubscriptionService,
} from "../../src/subscription/index.js";
import type { SubscriptionRecord } from "../../src/subscription/index.js";

const TARGET = "https://subscriber.example/hooks/worker";

let clock = 1_700_000_000_000;
let window = 41;
let ids = 0;

function service(overrides: Partial<ConstructorParameters<typeof SubscriptionService>[0]> = {}) {
  return new SubscriptionService({
    store: new MemorySubscriptionStore(),
    now: () => clock,
    newId: () => `sub-${++ids}`,
    currentWindow: () => window,
    ...overrides,
  });
}

async function created(svc: SubscriptionService, target = TARGET): Promise<SubscriptionRecord> {
  return svc.create({
    subscriber: "sub-acct-1",
    offering: "payroll-30d",
    webhookTarget: target,
    tier: "time-insensitive",
  });
}

beforeEach(() => {
  clock = 1_700_000_000_000;
  window = 41;
  ids = 0;
});

describe("create", () => {
  it("records subscriber, offering, target, tier and status", async () => {
    const svc = service();
    const record = await created(svc);

    expect(record).toMatchObject({
      subscriber: "sub-acct-1",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
      status: "active",
      cancelEffectiveWindow: null,
    });
    expect(record.audit).toEqual([
      {
        action: "create",
        at: clock,
        from: null,
        to: "active",
        window: 41,
        version: 1,
        tier: "time-insensitive",
      },
    ]);
  });

  it("rejects a webhook target that fails the SSRF guard", async () => {
    const svc = service();

    // Reusing pulse-webhooks' UrlValidator rather than a second
    // implementation: subscriber-supplied URLs are the classic SSRF vector.
    for (const bad of [
      "http://127.0.0.1/hook",
      "http://localhost:3000/hook",
      "http://10.0.0.5/hook",
      "http://192.168.1.1/hook",
      "http://169.254.169.254/latest/meta-data/",
      "file:///etc/passwd",
      "https://user:pass@example.com/hook",
      "not-a-url",
    ]) {
      await expect(created(svc, bad)).rejects.toMatchObject({
        code: "INVALID_WEBHOOK_TARGET",
      });
    }
  });

  it("rejects a target before anything is stored", async () => {
    const store = new MemorySubscriptionStore();
    const svc = service({ store });

    await expect(created(svc, "http://127.0.0.1/hook")).rejects.toBeInstanceOf(SubscriptionError);
    // A target that fails the guard must never reach the retry queue, which
    // means it must never reach the store either.
    expect(await store.listBySubscriber("sub-acct-1")).toEqual([]);
  });

  it("refuses the latency-sensitive tier, naming 22.4", async () => {
    const svc = service();
    const err = await svc
      .create({
        subscriber: "s",
        offering: "o",
        webhookTarget: TARGET,
        tier: "latency-sensitive",
      })
      .catch((e: unknown) => e as SubscriptionError);

    expect(err).toBeInstanceOf(SubscriptionError);
    expect(err.code).toBe("TIER_NOT_REGISTRABLE");
    expect(err.message).toContain("22.4");
  });

  it("rejects empty required fields", async () => {
    const svc = service();
    await expect(
      svc.create({
        subscriber: "  ",
        offering: "o",
        webhookTarget: TARGET,
        tier: "time-insensitive",
      }),
    ).rejects.toMatchObject({ code: "INVALID_FIELD" });
  });
});

describe("lifecycle", () => {
  it("pauses, resumes and cancels, appending to the audit trail", async () => {
    const svc = service();
    const record = await created(svc);

    clock += 1_000;
    const paused = await svc.pause(record.id, "subscriber asked");
    expect(paused.status).toBe("paused");

    clock += 1_000;
    const resumed = await svc.resume(paused.id);
    expect(resumed.status).toBe("active");

    clock += 1_000;
    const cancelled = await svc.cancel(resumed.id, "no longer needed");
    expect(cancelled.status).toBe("cancelled");

    expect(cancelled.audit.map((e) => e.action)).toEqual(["create", "pause", "resume", "cancel"]);
    expect(cancelled.audit.map((e) => [e.from, e.to])).toEqual([
      [null, "active"],
      ["active", "paused"],
      ["paused", "active"],
      ["active", "cancelled"],
    ]);
    // Reasons are carried; the trail is not just a state list.
    expect(cancelled.audit[1]?.reason).toBe("subscriber asked");
    expect(cancelled.audit[3]?.reason).toBe("no longer needed");
  });

  it("never rewrites an audit entry", async () => {
    const svc = service();
    const record = await created(svc);
    const first = record.audit[0];

    clock += 5_000;
    window += 3;
    const paused = await svc.pause(record.id);

    // Append-only: the original entry keeps its own timestamp and window.
    expect(paused.audit[0]).toEqual(first);
    expect(paused.audit[1]?.window).toBe(44);
  });

  it("takes cancellation effect within one window, and records which", async () => {
    const svc = service();
    const record = await created(svc);

    window = 50;
    const cancelled = await svc.cancel(record.id);

    // Never retroactive, never further out than the next window — and the
    // window is on the record, so "within one window" is checkable rather
    // than promised.
    expect(cancelled.cancelEffectiveWindow).toBe(51);
    expect(cancelled.audit.at(-1)?.window).toBe(50);
  });

  it("treats cancellation as terminal", async () => {
    const svc = service();
    const record = await created(svc);
    await svc.cancel(record.id);

    for (const op of [svc.pause(record.id), svc.resume(record.id), svc.cancel(record.id)]) {
      await expect(op).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });
    }
  });

  it("rejects an illegal transition", async () => {
    const svc = service();
    const record = await created(svc);

    // Already active.
    await expect(svc.resume(record.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await svc.pause(record.id);
    await expect(svc.pause(record.id)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("reports a missing subscription rather than inventing one", async () => {
    const svc = service();
    await expect(svc.get("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(svc.cancel("nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("subscriber read path (19.4)", () => {
  it("returns only that subscriber's subscriptions, newest first", async () => {
    const svc = service();
    const a = await created(svc);
    clock += 1_000;
    const b = await created(svc);
    clock += 1_000;
    const other = await svc.create({
      subscriber: "someone-else",
      offering: "payroll-30d",
      webhookTarget: TARGET,
      tier: "time-insensitive",
    });

    const mine = await svc.listBySubscriber("sub-acct-1");
    expect(mine.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(mine.map((r) => r.id)).not.toContain(other.id);
  });
});
