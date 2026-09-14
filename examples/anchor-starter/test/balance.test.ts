import { describe, it, expect, vi } from "vitest";
import { xdr } from "@stellar/stellar-sdk";

const simulateTransaction = vi.fn();

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  class MockServer {
    simulateTransaction = simulateTransaction;
  }
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: MockServer },
  };
});

const { checkUsdcBalance } = await import("../src/balance.js");

function i128ScVal(value: bigint): xdr.ScVal {
  const mask = (1n << 64n) - 1n;
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      hi: xdr.Int64.fromString(((value >> 64n) & mask).toString()),
      lo: xdr.Uint64.fromString((value & mask).toString()),
    }),
  );
}

describe("checkUsdcBalance (issue #908 - real path for the generated usdc.ts types)", () => {
  it("returns the decoded i128 balance on a successful simulation", async () => {
    simulateTransaction.mockResolvedValueOnce({
      result: { retval: i128ScVal(4_200_000n) },
    });

    await expect(
      checkUsdcBalance("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),
    ).resolves.toBe("4200000");
  });

  it("throws with the on-chain reason when the simulation errors (e.g. no trustline)", async () => {
    simulateTransaction.mockResolvedValueOnce({
      error: 'HostError: Error(Contract, #13): trustline entry is missing for account',
    });

    await expect(
      checkUsdcBalance("GADJTK7TI64VH7WG3EQHOSZ6CRBDJI7L4U3IH3DAZYTPL643VQHNKM36"),
    ).rejects.toThrow(/trustline entry is missing/);
  });
});
