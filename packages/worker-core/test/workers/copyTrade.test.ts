import { describe, it, expect, vi } from "vitest";
import {
  createCopyTradeTrigger,
  computeMirroredSize,
  planCopyTrade,
  type ObservedTrade,
  type CopyTradeWorkerConfig,
} from "../../src/workers/copyTrade.js";
import type { VaultClient, VaultConfig, VaultExecutionResult } from "../../src/vault/types.js";

const NOW = 1_800_000_000;
const LEDGER = 1_000_000;

function observedTrade(overrides: Partial<ObservedTrade> = {}): ObservedTrade {
  return {
    sourceAccount: "GWHALE...",
    asset: "USDC",
    pool: "USDC/XLM",
    side: "buy",
    sizeRaw: 1_000_000n,
    sourceTxHash: "abc123",
    observedAtLedgerSequence: LEDGER,
    ...overrides,
  };
}

function vaultConfig(overrides: Partial<VaultConfig> = {}): VaultConfig {
  return {
    vaultId: "vault-1",
    subscriberAccount: "GSUBSCRIBER...",
    maxPositionSizeRaw: 10_000_000n,
    allowListedAssets: ["USDC"],
    allowListedPools: ["USDC/XLM"],
    slippageBoundBps: 50,
    ...overrides,
  };
}

function fakeVaultClient(params: {
  config?: Partial<VaultConfig>;
  executeResult?: VaultExecutionResult;
}): VaultClient & { executeCalls: unknown[] } {
  const config = vaultConfig(params.config);
  const executeResult: VaultExecutionResult = params.executeResult ?? {
    status: "executed",
    txHash: "tx-1",
    executedAtUnix: NOW,
  };
  const executeCalls: unknown[] = [];
  return {
    executeCalls,
    getConfig: async () => config,
    execute: async (request) => {
      executeCalls.push(request);
      return executeResult;
    },
  };
}

function revocation(revoked: boolean) {
  return { isRevoked: async () => revoked };
}

function baseConfig(overrides: Partial<CopyTradeWorkerConfig> = {}): CopyTradeWorkerConfig {
  return {
    workerId: "copy-trade-1",
    vaultClient: fakeVaultClient({}),
    vaultId: "vault-1",
    revocation: revocation(false),
    latencyBudget: { maxLedgers: 5 },
    ...overrides,
  };
}

describe("createCopyTradeTrigger", () => {
  it("builds an EventTrigger, not a bespoke shape", () => {
    const trigger = createCopyTradeTrigger("GWHALE...", "USDC");
    expect(trigger.kind).toBe("event");
    expect(trigger.contractId).toBe("GWHALE...");
    expect(trigger.eventTopic).toBe("trade.executed.USDC");
  });
});

describe("computeMirroredSize", () => {
  it("mirrors proportionally at the configured ratio", () => {
    const size = computeMirroredSize(observedTrade({ sizeRaw: 1_000_000n }), vaultConfig(), 5_000); // 50%
    expect(size).toBe(500_000n);
  });

  it("caps at the vault's maxPositionSizeRaw", () => {
    const size = computeMirroredSize(
      observedTrade({ sizeRaw: 100_000_000n }),
      vaultConfig({ maxPositionSizeRaw: 10_000_000n }),
      10_000, // 100%
    );
    expect(size).toBe(10_000_000n);
  });
});

describe("planCopyTrade", () => {
  it("mirrors an observed trade into a vault execution within the latency bound", async () => {
    const client = fakeVaultClient({});
    const config = baseConfig({ vaultClient: client });
    const outcome = await planCopyTrade(observedTrade(), config, 10_000, LEDGER + 2, NOW);

    expect(outcome.status).toBe("executed");
    expect(client.executeCalls).toHaveLength(1);
  });

  it("never holds subscriber assets - the only path to execution is vaultClient.execute", async () => {
    // Structural, not a runtime assertion: `CopyTradeWorkerConfig` and
    // `ObservedTrade` carry no signer, secret, or balance field, and this
    // test's fake client is the *only* thing that ever sees a size or asset.
    const client = fakeVaultClient({});
    await planCopyTrade(
      observedTrade(),
      baseConfig({ vaultClient: client }),
      10_000,
      LEDGER + 1,
      NOW,
    );
    expect(client.executeCalls[0]).not.toHaveProperty("secret");
    expect(client.executeCalls[0]).not.toHaveProperty("signer");
  });

  it("skips, records, and notifies for an asset that is not allow-listed - never silently dropped", async () => {
    const onSkip = vi.fn();
    const client = fakeVaultClient({ config: { allowListedAssets: ["USDC"] } });
    const config = baseConfig({ vaultClient: client, onSkip });

    const outcome = await planCopyTrade(
      observedTrade({ asset: "SHITCOIN" }),
      config,
      10_000,
      LEDGER + 1,
      NOW,
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.skip.reason).toBe("asset_not_allow_listed");
    expect(onSkip).toHaveBeenCalledWith(outcome.skip);
    expect(client.executeCalls).toHaveLength(0);
  });

  it("skips a pool that is not allow-listed", async () => {
    const client = fakeVaultClient({ config: { allowListedPools: ["USDC/XLM"] } });
    const outcome = await planCopyTrade(
      observedTrade({ pool: "USDC/UNKNOWN" }),
      baseConfig({ vaultClient: client }),
      10_000,
      LEDGER + 1,
      NOW,
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.skip.reason).toBe("pool_not_allow_listed");
  });

  it("skips (not silently caps to a phantom trade) when the position-size bound zeroes out the mirror", async () => {
    const client = fakeVaultClient({ config: { maxPositionSizeRaw: 0n } });
    const outcome = await planCopyTrade(
      observedTrade(),
      baseConfig({ vaultClient: client }),
      10_000,
      LEDGER + 1,
      NOW,
    );
    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.skip.reason).toBe("position_size_zero_after_bound");
    expect(client.executeCalls).toHaveLength(0);
  });

  it("records a slippage revert as a skip, not a miss", async () => {
    const client = fakeVaultClient({
      executeResult: { status: "reverted", reason: "slippage_exceeded", txHash: "tx-reverted" },
    });
    const outcome = await planCopyTrade(
      observedTrade(),
      baseConfig({ vaultClient: client }),
      10_000,
      LEDGER + 1,
      NOW,
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.skip.reason).toBe("slippage_reverted");
    expect(outcome.skip.detail).toEqual({ txHash: "tx-reverted" });
  });

  it("stops within one window when the subscriber has revoked mid-flight", async () => {
    const client = fakeVaultClient({});
    const config = baseConfig({ vaultClient: client, revocation: revocation(true) });
    const outcome = await planCopyTrade(observedTrade(), config, 10_000, LEDGER + 1, NOW);

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.skip.reason).toBe("subscriber_revoked");
    expect(client.executeCalls).toHaveLength(0);
  });

  it("skips a trade observed too many ledgers ago, without even consulting the vault", async () => {
    const client = fakeVaultClient({});
    const getConfig = vi.spyOn(client, "getConfig");
    const config = baseConfig({ vaultClient: client, latencyBudget: { maxLedgers: 2 } });

    const outcome = await planCopyTrade(
      observedTrade({ observedAtLedgerSequence: LEDGER }),
      config,
      10_000,
      LEDGER + 3, // 3 ledgers elapsed, budget is 2
      NOW,
    );

    expect(outcome.status).toBe("skipped");
    if (outcome.status !== "skipped") return;
    expect(outcome.skip.reason).toBe("latency_budget_exceeded");
    expect(getConfig).not.toHaveBeenCalled();
  });

  it("permits a trade exactly at the latency budget", async () => {
    const client = fakeVaultClient({});
    const config = baseConfig({ vaultClient: client, latencyBudget: { maxLedgers: 2 } });
    const outcome = await planCopyTrade(observedTrade(), config, 10_000, LEDGER + 2, NOW);
    expect(outcome.status).toBe("executed");
  });
});
