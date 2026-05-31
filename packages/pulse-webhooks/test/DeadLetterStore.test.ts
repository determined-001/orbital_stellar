import { describe, it, expect, vi } from "vitest";
import { MemoryDeadLetterStore } from "../src/DeadLetterStore.js";
import { WebhookDelivery } from "../src/index.js";
import { Watcher } from "@orbital/pulse-core";

describe("MemoryDeadLetterStore", () => {
  it("should record failures and support retrieval with generated id and timestamp", async () => {
    const store = new MemoryDeadLetterStore();
    const event = { type: "payment.received", id: 1 };

    await store.record({
      url: "https://example.com/failed",
      event,
      error: "Connection refused",
      attempts: 3,
    });

    const list = await store.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBeDefined();
    expect(typeof list[0].id).toBe("string");
    expect(list[0].timestamp).toBeDefined();
    expect(typeof list[0].timestamp).toBe("number");
    expect(list[0].url).toBe("https://example.com/failed");
    expect(list[0].event).toEqual(event);
    expect(list[0].error).toBe("Connection refused");
    expect(list[0].attempts).toBe(3);
  });

  it("should enforce the capacity limit and evict oldest via FIFO", async () => {
    // Set a very small cap of 3
    const store = new MemoryDeadLetterStore(3);

    for (let i = 1; i <= 4; i++) {
      await store.record({
        url: `https://example.com/failed/${i}`,
        event: { index: i },
        error: "test",
        attempts: 1,
      });
    }

    const list = await store.list();
    expect(list.length).toBe(3);
    // Since it's FIFO eviction, the oldest (index 1) should be evicted
    expect(list[0].url).toBe("https://example.com/failed/2");
    expect(list[1].url).toBe("https://example.com/failed/3");
    expect(list[2].url).toBe("https://example.com/failed/4");
  });

  it("should support filter queries on list", async () => {
    const store = new MemoryDeadLetterStore();

    await store.record({
      url: "https://example.com/abc",
      event: { type: "payment.received" },
      error: "network_error",
      attempts: 3,
    });

    await store.record({
      url: "https://example.com/xyz",
      event: { type: "trustline.added" },
      reason: "retry_cap_exceeded",
      attempts: 1,
    });

    // 1. Filter by url
    const filteredByUrl = await store.list({ url: "https://example.com/abc" });
    expect(filteredByUrl.length).toBe(1);
    expect(filteredByUrl[0].url).toBe("https://example.com/abc");

    // 2. Filter by type
    const filteredByType = await store.list({ type: "trustline.added" });
    expect(filteredByType.length).toBe(1);
    expect(filteredByType[0].event.type).toBe("trustline.added");

    // 3. Filter by reason/error
    const filteredByError = await store.list({ reason: "network_error" });
    expect(filteredByError.length).toBe(1);
    expect(filteredByError[0].error).toBe("network_error");

    const filteredByReason = await store.list({ reason: "retry_cap_exceeded" });
    expect(filteredByReason.length).toBe(1);
    expect(filteredByReason[0].reason).toBe("retry_cap_exceeded");
  });
});

describe("WebhookDelivery DeadLetterStore automatic recording", () => {
  it("should record failed and dropped webhooks automatically", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("DNS Resolution Failed"));

    try {
      const watcher = new Watcher("GABC", { strictStoppedListeners: false });
      const store = new MemoryDeadLetterStore();

      // Configure a WebhookDelivery with zero retries so it fails terminally on first shot
      new WebhookDelivery(watcher, {
        url: "https://dlq-test.com/endpoint",
        secret: "super-secret",
        retries: 1,
        deadLetterStore: store,
      });

      const testEvent = {
        type: "payment.received",
        to: "GABC",
        from: "GDEF",
        amount: "50",
        asset: "XLM",
        timestamp: new Date().toISOString(),
        raw: {},
      };

      watcher.emit("*", testEvent);

      // Wait a moment for async delivery to fail and call store.record
      await new Promise(resolve => setTimeout(resolve, 50));

      const failures = await store.list();
      expect(failures.length).toBe(1);
      expect(failures[0].url).toBe("https://dlq-test.com/endpoint");
      expect(failures[0].event).toEqual(testEvent);
      expect(failures[0].error).toBe("DNS Resolution Failed");
      expect(failures[0].attempts).toBe(1);

      watcher.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
