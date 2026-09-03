import { describe, it, expect } from "vitest";
import { UNIMPLEMENTED_VAULT_CLIENT, VaultNotImplementedError } from "../../src/vault/index.js";

describe("UNIMPLEMENTED_VAULT_CLIENT", () => {
  it("getConfig throws VaultNotImplementedError - there is no real vault contract (22.1) yet", async () => {
    await expect(UNIMPLEMENTED_VAULT_CLIENT.getConfig("vault-1")).rejects.toBeInstanceOf(
      VaultNotImplementedError,
    );
  });

  it("execute throws VaultNotImplementedError", async () => {
    await expect(
      UNIMPLEMENTED_VAULT_CLIENT.execute({
        vaultId: "vault-1",
        asset: "USDC",
        pool: "USDC/XLM",
        side: "buy",
        sizeRaw: 1n,
        maxSlippageBps: 50,
      }),
    ).rejects.toBeInstanceOf(VaultNotImplementedError);
  });

  it("names the method that was called, so the error is diagnosable", async () => {
    await expect(UNIMPLEMENTED_VAULT_CLIENT.getConfig("vault-1")).rejects.toThrow(/getConfig/);
  });
});
