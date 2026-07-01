import { describe, it, expect, afterEach } from "vitest";
import { EventEngine } from "../src/EventEngine.js";
import { SorobanRpcClient } from "../src/SorobanRpcClient.js";
import { NetworkMismatchError } from "../src/errors.js";

describe("EventEngine network drift detection", () => {
  afterEach(() => {
    // Clear any cached network between tests
    SorobanRpcClient.setCachedNetwork(null);
  });

  it("throws NetworkMismatchError when cached Soroban RPC passphrase differs from configured network", () => {
    // Cache a mismatched passphrase (simulate RPC pointing to mainnet while engine configured for testnet)
    SorobanRpcClient.setCachedNetwork({
      passphrase: "Public Global Stellar Network ; September 2015",
    });

    const engine = new EventEngine({ network: "testnet" });

    expect(() => engine.start()).toThrow(NetworkMismatchError);
  });

  it("does not throw when cached passphrase matches expected network", () => {
    SorobanRpcClient.setCachedNetwork({ passphrase: "Test SDF Network ; September 2015" });
    const engine = new EventEngine({ network: "testnet" });
    const started = engine.start();
    expect(started).toBe(true);
    engine.stop();
  });

  it("catches a mismatch discovered asynchronously (RPC probe resolves after start())", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            passphrase: "Public Global Stellar Network ; September 2015",
            protocolVersion: 22,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;

    try {
      const errors: Array<{ msg: string; meta?: unknown }> = [];
      const engine = new EventEngine({
        network: "testnet",
        soroban: { rpcUrl: "https://fake-rpc.example" },
        logger: {
          info: () => {},
          warn: () => {},
          error: (msg: string, meta?: Record<string, unknown>) => errors.push({ msg, meta }),
        },
      });

      // Mirrors real-world usage: start() is called immediately after construction,
      // before the constructor's getNetwork() probe has had a chance to resolve.
      engine.start();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(errors.some((e) => e.msg.includes("network mismatch"))).toBe(true);
      expect((engine as unknown as { isRunning: boolean }).isRunning).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
