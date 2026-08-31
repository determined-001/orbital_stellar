import { describe, expect, it, vi } from "vitest";
import {
  Account,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  Transaction,
  nativeToScVal,
} from "@stellar/stellar-sdk";
import { SorobanRpcError } from "@orbital-stellar/pulse-core";
import type {
  SorobanGetTransactionResult,
  SorobanRpcClient,
  SorobanSendTransactionResult,
  SorobanSimulateTransactionResult,
} from "@orbital-stellar/pulse-core";

import { TxSubmitter } from "../src/TxSubmitter.js";
import { OperatorSigner } from "../src/OperatorSigner.js";
import { BASE_FEE_STROOPS } from "../src/fees.js";
import type { WorkerDefinition } from "../src/types.js";

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 9));
const OPERATOR = Keypair.random();

const worker: WorkerDefinition = {
  id: "worker-1",
  operator: OPERATOR.publicKey(),
  targetContractId: CONTRACT_ID,
  functionName: "disburse",
  buildArgs: () => [1],
  trigger: { kind: "time", schedule: { kind: "interval", everyMs: 60_000, timezone: "UTC" } },
  network: "testnet",
};

/**
 * Args reach the submitter already encoded, not off the definition:
 * `buildArgs` is a pure `ChainState -> TArgs` builder owned by the worker
 * author, and encoding belongs with whoever defined the worker.
 */
const ARGS = [nativeToScVal(1, { type: "u32" })];

/** A simulation the assembler will accept: real (empty) footprint, one result. */
function simulationSuccess(
  overrides: Partial<SorobanSimulateTransactionResult> = {},
): SorobanSimulateTransactionResult {
  return {
    id: "1",
    latestLedger: 100,
    minResourceFee: "1000",
    transactionData: new SorobanDataBuilder().build().toXDR("base64"),
    results: [{ xdr: nativeToScVal(null).toXDR("base64"), auth: [] }],
    ...overrides,
  };
}

type FakeCalls = {
  simulate: SorobanSimulateTransactionResult | Error;
  send?: SorobanSendTransactionResult | Error;
  poll?: Array<SorobanGetTransactionResult> | Error;
};

function fakeClient(calls: FakeCalls) {
  const sendTransaction = vi.fn(async (xdr: string) => {
    if (calls.send instanceof Error) throw calls.send;
    submittedXdr.push(xdr);
    return calls.send ?? { status: "PENDING" as const, hash: "tx-hash" };
  });

  const submittedXdr: string[] = [];
  let pollIndex = 0;

  const client = {
    simulateTransaction: vi.fn(async () => {
      if (calls.simulate instanceof Error) throw calls.simulate;
      return calls.simulate;
    }),
    sendTransaction,
    pollTransaction: vi.fn(async () => {
      if (calls.poll instanceof Error) throw calls.poll;
      const results = calls.poll ?? [{ status: "SUCCESS" as const, ledger: 42 }];
      const result = results[Math.min(pollIndex, results.length - 1)]!;
      pollIndex += 1;
      return result;
    }),
  } as unknown as SorobanRpcClient;

  return { client, submittedXdr, sendTransaction };
}

function buildSubmitter(
  calls: FakeCalls,
  options: { feeMultiplier?: number; maxFeeStroops?: number } = {},
) {
  const fake = fakeClient(calls);
  const submitter = new TxSubmitter({
    client: fake.client,
    signer: OperatorSigner.fromSecret(OPERATOR.secret(), {
      networkPassphrase: Networks.TESTNET,
    }),
    networkPassphrase: Networks.TESTNET,
    loadAccount: async (accountId) => new Account(accountId, "7"),
    ...options,
  });
  return { submitter, ...fake };
}

describe("TxSubmitter", () => {
  it("simulates, prices from the simulation, signs and confirms", async () => {
    const { submitter, submittedXdr, client } = buildSubmitter({
      simulate: simulationSuccess({ minResourceFee: "1000" }),
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("submitted");
    if (outcome.status !== "submitted") return;

    expect(outcome.hash).toBe("tx-hash");
    expect(outcome.ledger).toBe(42);
    // 1000 * 1.5 default multiplier, plus the classic base fee.
    expect(outcome.fee.totalStroops).toBe(1500 + BASE_FEE_STROOPS);

    // Simulation happens before anything is signed or sent.
    expect(client.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(submittedXdr).toHaveLength(1);

    const submitted = new Transaction(submittedXdr[0]!, Networks.TESTNET);
    expect(submitted.fee).toBe(String(1500 + BASE_FEE_STROOPS));
    expect(submitted.signatures).toHaveLength(1);
    expect(submitted.source).toBe(OPERATOR.publicKey());
  });

  it("confirms by polling rather than assuming a successful send", async () => {
    const { submitter, client } = buildSubmitter({
      simulate: simulationSuccess(),
      poll: [{ status: "SUCCESS", ledger: 51 }],
    });

    await submitter.submit(worker, ARGS);

    expect(client.pollTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports an on-chain failure as failed, not submitted", async () => {
    const { submitter } = buildSubmitter({
      simulate: simulationSuccess(),
      poll: [{ status: "FAILED", resultXdr: "AAAA" }],
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(false);
    expect(outcome.hash).toBe("tx-hash");
  });

  it("classifies a contract rejection separately from a failure", async () => {
    const { submitter, submittedXdr } = buildSubmitter({
      simulate: simulationSuccess({
        error: "HostError: Error(Contract, #4) - not yet due",
      }),
    });

    const outcome = await submitter.submit(worker, ARGS);

    // A permissionless disburse() refusing an early call is the design working.
    expect(outcome.status).toBe("contract_rejected");
    if (outcome.status !== "contract_rejected") return;
    expect(outcome.reason).toContain("not yet due");
    // Nothing was signed or sent.
    expect(submittedXdr).toHaveLength(0);
  });

  it("classifies an infrastructure failure as retryable", async () => {
    const { submitter } = buildSubmitter({
      simulate: new SorobanRpcError("rpc unavailable", { code: "server", retryable: true }),
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(true);
    expect(outcome.reason).toContain("rpc unavailable");
  });

  it("treats a simulation error that is not a contract rejection as retryable infrastructure", async () => {
    const { submitter } = buildSubmitter({
      simulate: simulationSuccess({ error: "connection reset by peer" }),
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(true);
  });

  it("never signs or sends a transaction whose fee breaches the cap", async () => {
    const { submitter, submittedXdr } = buildSubmitter(
      { simulate: simulationSuccess({ minResourceFee: "9000" }) },
      { maxFeeStroops: 5_000 },
    );

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.reason).toContain("exceeds the configured cap");
    expect(outcome.retryable).toBe(true);
    expect(submittedXdr).toHaveLength(0);
  });

  it("surfaces a send-side rejection as terminal", async () => {
    const { submitter } = buildSubmitter({
      simulate: simulationSuccess(),
      send: { status: "ERROR", hash: "tx-hash", errorResultXdr: "AAAA" },
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(false);
  });

  it("treats TRY_AGAIN_LATER as retryable", async () => {
    const { submitter } = buildSubmitter({
      simulate: simulationSuccess(),
      send: { status: "TRY_AGAIN_LATER", hash: "tx-hash" },
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(true);
  });

  it("reports an unconfirmed transaction as retryable rather than lost", async () => {
    const { submitter } = buildSubmitter({
      simulate: simulationSuccess(),
      poll: new SorobanRpcError("transaction tx-hash was not confirmed within 60000ms", {
        code: "server",
        retryable: true,
      }),
    });

    const outcome = await submitter.submit(worker, ARGS);

    expect(outcome.status).toBe("failed");
    if (outcome.status !== "failed") return;
    expect(outcome.retryable).toBe(true);
    expect(outcome.hash).toBe("tx-hash");
  });

  it("exposes a dry-run path that never reaches signing", async () => {
    const { submitter, submittedXdr } = buildSubmitter({ simulate: simulationSuccess() });

    const built = await submitter.build(worker, ARGS);

    expect(built.status).toBe("built");
    expect(submittedXdr).toHaveLength(0);
  });
});
