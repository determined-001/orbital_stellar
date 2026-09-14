import {
  Account,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  rpc,
} from "@stellar/stellar-sdk";
import type { BalanceParams, BalanceReturns } from "./generated/usdc.js";

/** Mainnet USDC - the well-known contract `orbital.config.ts` generates types for (issue #908). */
export const USDC_CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

/**
 * Reads an account's USDC balance via a read-only simulation - no
 * transaction is ever submitted, so no fee and no signature is needed
 * beyond a throwaway source account for the simulation envelope.
 *
 * Real usage for a SEP-31 anchor consumer: confirm a cross-border send
 * actually landed by checking the recipient's balance before and after.
 * USDC is mainnet-only; called against a testnet account this simulation
 * fails the same way any lookup of a nonexistent contract would - which is
 * the honest answer, not a reason to fake a balance.
 */
export async function checkUsdcBalance(accountId: string): Promise<BalanceReturns> {
  const server = new rpc.Server("https://mainnet.sorobanrpc.com");
  const contract = new Contract(USDC_CONTRACT_ID);
  const params: BalanceParams = { id: accountId };

  // Simulation only needs a valid-shaped source account, not one that
  // exists or can sign a real transaction - nothing here is submitted.
  const source = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(source, { fee: "100", networkPassphrase: Networks.PUBLIC })
    .addOperation(contract.call("balance", nativeToScVal(params.id, { type: "address" })))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(result)) {
    throw new Error(`USDC balance simulation failed: ${result.error}`);
  }
  if (!result.result) {
    throw new Error("USDC balance simulation returned no result.");
  }

  // scValToNative decodes i128 to a bigint; the generated BalanceReturns is
  // `string` (mapContractSpecTypeToTs maps every wide integer type to string,
  // since i128/u256/etc overflow JS's `number`) - stringify for real rather
  // than asserting a type scValToNative never actually returns.
  const balance = scValToNative(result.result.retval) as bigint;
  return balance.toString() satisfies BalanceReturns;
}
