import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEngine } from "../../src/EventEngine.js";

// Skip integration tests unless INTEGRATION_TESTS env var is set
const integrationTest = process.env.INTEGRATION_TESTS ? it : it.skip;

describe("Horizon Integration Tests", () => {
  let engine: EventEngine;

  // A public testnet account that regularly receives payments from the Stellar testnet faucet
  const TESTNET_ACCOUNT = "GBBDQF3HQ4I7KZ7A5LJ4SXGWH4U7KRN2WA4YOJXKXEBVNBKWO6BMGQRF";

  beforeEach(() => {
    engine = new EventEngine({
      network: "testnet",
      reconnect: {
        initialDelayMs: 500,
        maxDelayMs: 5000,
        maxRetries: 3,
      },
    });
  });

  afterEach(() => {
    engine.stop();
  });

  integrationTest("connects to live Horizon testnet and streams payments", async () => {
    return new Promise<void>((resolve, reject) => {
      const events: unknown[] = [];
      let timeout: NodeJS.Timeout;

      const watcher = engine.subscribe(TESTNET_ACCOUNT);

      watcher.on("payment.received", (event) => {
        events.push(event);
        console.log("Received payment event:", event);

        // Verify event structure
        expect(event).toMatchObject({
          type: "payment.received",
          to: TESTNET_ACCOUNT,
          amount: expect.any(String),
          asset: expect.any(String),
          timestamp: expect.any(String),
          raw: expect.any(Object),
        });

        // Verify the raw event has expected fields
        expect((event as { raw: Record<string, unknown> }).raw).toMatchObject({
          type: "payment",
          to: TESTNET_ACCOUNT,
          from: expect.any(String),
          amount: expect.any(String),
          asset_type: expect.any(String),
          created_at: expect.any(String),
        });

        if (events.length > 0) {
          clearTimeout(timeout);
          watcher.stop();
          resolve();
        }
      });

      watcher.on("engine.reconnected", (event) => {
        console.log("Engine reconnected:", event);
      });

      watcher.on("engine.reconnecting", (event) => {
        console.log("Engine reconnecting:", event);
      });

      engine.start();

      timeout = setTimeout(() => {
        watcher.stop();
        reject(new Error("No payment events received within 60 seconds"));
      }, 60000);
    });
  }, 65000);

  integrationTest("stops cleanly and removes watcher from registry", async () => {
    const watcher = engine.subscribe(TESTNET_ACCOUNT);

    // Watcher should appear in the engine's registry immediately after subscribe
    expect((engine as unknown as { registry: Map<string, unknown> }).registry.has(TESTNET_ACCOUNT)).toBe(true);

    engine.start();

    // Give the stream a moment to open
    await new Promise((r) => setTimeout(r, 500));

    // Stop the watcher — should trigger onStop and remove it from the registry
    watcher.stop();

    expect((engine as unknown as { registry: Map<string, unknown> }).registry.has(TESTNET_ACCOUNT)).toBe(false);
  }, 10000);

  integrationTest("properly normalizes different asset types", async () => {
    return new Promise<void>((resolve, reject) => {
      let eventCount = 0;
      let timeout: NodeJS.Timeout;

      const watcher = engine.subscribe(TESTNET_ACCOUNT);

      watcher.on("payment.received", (event) => {
        eventCount++;
        const e = event as { asset: string; raw: Record<string, unknown> };

        // Test asset normalization
        if (e.raw.asset_type === "native") {
          expect(e.asset).toBe("XLM");
        } else if (e.raw.asset_type === "credit_alphanum4" || e.raw.asset_type === "credit_alphanum12") {
          expect(e.asset).toBe(`${e.raw.asset_code}:${e.raw.asset_issuer}`);
        }

        // One event is enough to verify normalization
        if (eventCount >= 1) {
          clearTimeout(timeout);
          watcher.stop();
          resolve();
        }
      });

      watcher.on("error", (error) => {
        console.error("Error in asset normalization test:", error);
        clearTimeout(timeout);
        reject(error);
      });

      engine.start();

      timeout = setTimeout(() => {
        watcher.stop();
        if (eventCount > 0) {
          resolve();
        } else {
          reject(new Error("No events received for asset normalization test"));
        }
      }, 45000);
    });
  }, 50000);

  integrationTest("maintains watcher registry during active subscription", async () => {
    return new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout;

      const watcher = engine.subscribe(TESTNET_ACCOUNT);

      // Watcher must be in the registry immediately after subscribe
      expect((engine as unknown as { registry: Map<string, unknown> }).registry.has(TESTNET_ACCOUNT)).toBe(true);

      watcher.on("engine.reconnecting", () => {
        // Verify watcher is still in registry during reconnection
        expect((engine as unknown as { registry: Map<string, unknown> }).registry.has(TESTNET_ACCOUNT)).toBe(true);
      });

      engine.start();

      timeout = setTimeout(() => {
        // Verify registry still contains the watcher after 30 s of active streaming
        expect((engine as unknown as { registry: Map<string, unknown> }).registry.has(TESTNET_ACCOUNT)).toBe(true);
        watcher.stop();
        resolve();
      }, 30000);

      watcher.on("error", (error) => {
        console.error("Error in registry test:", error);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }, 35000);
});
