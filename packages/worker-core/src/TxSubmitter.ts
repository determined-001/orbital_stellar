import {
  Account,
  Contract,
  TransactionBuilder,
  rpc as StellarRpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import { SorobanRpcError } from "@orbital-stellar/pulse-core";
import type {
  SorobanGetTransactionResult,
  SorobanRpcClient,
  SorobanSimulateTransactionResult,
} from "@orbital-stellar/pulse-core";

import { BASE_FEE_STROOPS, resolveFee, type FeeConfig, type ResolvedFee } from "./fees.js";
import type { OperatorSigner } from "./OperatorSigner.js";
import type { WorkerDefinition } from "./types.js";
import type { xdr } from "@stellar/stellar-sdk";

/**
 * Why a submission did not go through.
 *
 * `contract_rejected` is a *correct* outcome, not a fault: a permissionless
 * `disburse()` refusing a call that is not yet due is the design working. It is
 * kept distinct from infrastructure failure so downstream scoring (19.1) does
 * not count it as a miss, and so a retry loop does not hammer a contract that
 * will keep saying no.
 */
export type SubmissionOutcome =
  | { status: "submitted"; hash: string; ledger?: number; fee: ResolvedFee }
  | { status: "contract_rejected"; reason: string; simulation: SorobanSimulateTransactionResult }
  | { status: "failed"; reason: string; hash?: string; retryable: boolean };

export type TxSubmitterOptions = FeeConfig & {
  client: SorobanRpcClient;
  /** The single key this submitter may sign with. */
  signer: OperatorSigner;
  networkPassphrase: string;
  /** How long to wait for the transaction to land before reporting an unknown outcome. Defaults to 60s. */
  confirmTimeoutMs?: number;
  /** Poll interval while confirming. Defaults to 1s. */
  confirmIntervalMs?: number;
  /** Sequence-number source for the operator account. Defaults to reading it from the RPC's account entry via `loadAccount`. */
  loadAccount?: (accountId: string) => Promise<Account>;
};

/**
 * Matches host errors that mean "the contract said no", as opposed to the
 * transport, the account, or the fee being wrong. A contract that panics with
 * its own error code lands here; a malformed request or an unreachable RPC does
 * not.
 */
const CONTRACT_REJECTION =
  /HostError|Error\(Contract|InvokeHostFunction.*failed|contract call failed/i;

/**
 * Turns a due worker decision into a signed, submitted Soroban invocation.
 *
 * Every RPC call goes through `pulse-core`'s {@link SorobanRpcClient} rather
 * than a second client layer, and the transaction is **simulated before it is
 * signed**: the footprint, the auth entries and the resource fee all come from
 * that simulation, and the fee is padded by a bounded, configurable multiplier
 * (see `fees.ts`) so a congested ledger cannot drain the operator's float.
 *
 * The submitter signs with the operator's own account and nothing else - see
 * {@link OperatorSigner} for why a second signer cannot be added quietly.
 */
export class TxSubmitter {
  private readonly client: SorobanRpcClient;
  private readonly signer: OperatorSigner;
  private readonly networkPassphrase: string;
  private readonly feeConfig: FeeConfig;
  private readonly confirmTimeoutMs: number;
  private readonly confirmIntervalMs: number;
  private readonly loadAccount: (accountId: string) => Promise<Account>;

  constructor(options: TxSubmitterOptions) {
    this.client = options.client;
    this.signer = options.signer;
    this.networkPassphrase = options.networkPassphrase;
    this.feeConfig = {
      ...(options.feeMultiplier !== undefined ? { feeMultiplier: options.feeMultiplier } : {}),
      ...(options.maxFeeStroops !== undefined ? { maxFeeStroops: options.maxFeeStroops } : {}),
    };
    this.confirmTimeoutMs = options.confirmTimeoutMs ?? 60_000;
    this.confirmIntervalMs = options.confirmIntervalMs ?? 1_000;
    this.loadAccount =
      options.loadAccount ??
      (() => {
        throw new Error(
          "[worker-core] TxSubmitter needs a loadAccount source for the operator's sequence number.",
        );
      });
  }

  /**
   * Builds, simulates, signs, submits and confirms one worker invocation.
   *
   * `args` are passed in already encoded as `ScVal`s rather than read off the
   * definition, because `WorkerDefinition.buildArgs` is a pure
   * `ChainState -> TArgs` builder whose output type is the worker author's,
   * not the submitter's. Encoding belongs to whoever defined the worker; the
   * submitter does not interpret worker arguments.
   *
   * Never throws for an outcome the caller is expected to handle - a contract
   * rejection and an infrastructure failure both come back as a
   * {@link SubmissionOutcome}. Programming errors (a bad fee config, a missing
   * account source) still throw.
   */
  async submit(worker: WorkerDefinition, args: xdr.ScVal[]): Promise<SubmissionOutcome> {
    const built = await this.build(worker, args);
    if (built.status !== "built") return built.outcome;

    const { transaction, simulation } = built;

    let fee: ResolvedFee;
    try {
      fee = resolveFee(simulation.minResourceFee ?? "0", this.feeConfig);
    } catch (error) {
      // A capped-out fee is a decision, not a crash: report it and let the
      // caller decide whether to wait for a cheaper ledger.
      return {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
      };
    }

    // `assembleTransaction` takes the RPC's raw simulation shape, which is
    // exactly what `simulateTransaction` returns; `id`/`latestLedger` are
    // required by its type but unused by the assembly itself.
    const rawSimulation = {
      id: simulation.id ?? "",
      latestLedger: simulation.latestLedger ?? 0,
      ...simulation,
    } as StellarRpc.Api.RawSimulateTransactionResponse;

    const assembled = StellarRpc.assembleTransaction(transaction, rawSimulation).build();
    const priced = TransactionBuilder.cloneFrom(assembled, {
      fee: String(fee.totalStroops),
    }).build();

    this.signer.sign(priced);

    let sent;
    try {
      sent = await this.client.sendTransaction(priced.toXDR());
    } catch (error) {
      return this.infrastructureFailure(error);
    }

    if (sent.status === "ERROR") {
      return {
        status: "failed",
        reason: `sendTransaction rejected the transaction (${sent.errorResultXdr ?? "no result xdr"})`,
        hash: sent.hash,
        retryable: false,
      };
    }

    if (sent.status === "TRY_AGAIN_LATER") {
      return {
        status: "failed",
        reason: "the RPC asked for the submission to be retried later",
        hash: sent.hash,
        retryable: true,
      };
    }

    // PENDING and DUPLICATE both mean "the network may include this" - neither
    // means it succeeded, so the outcome is confirmed, never assumed.
    let confirmed: SorobanGetTransactionResult;
    try {
      confirmed = await this.client.pollTransaction(sent.hash, {
        intervalMs: this.confirmIntervalMs,
        timeoutMs: this.confirmTimeoutMs,
      });
    } catch (error) {
      return this.infrastructureFailure(error, sent.hash);
    }

    if (confirmed.status === "FAILED") {
      return {
        status: "failed",
        reason: `transaction ${sent.hash} failed on-chain (${confirmed.resultXdr ?? "no result xdr"})`,
        hash: sent.hash,
        retryable: false,
      };
    }

    return {
      status: "submitted",
      hash: sent.hash,
      ...(confirmed.ledger !== undefined ? { ledger: confirmed.ledger } : {}),
      fee,
    };
  }

  /**
   * Builds the unsigned transaction and simulates it.
   *
   * Split out so a caller can dry-run a worker - simulate, read the fee, decide -
   * without ever reaching the signing path.
   */
  async build(
    worker: WorkerDefinition,
    args: xdr.ScVal[],
  ): Promise<
    | { status: "built"; transaction: Transaction; simulation: SorobanSimulateTransactionResult }
    | { status: "aborted"; outcome: SubmissionOutcome }
  > {
    const source = await this.loadAccount(this.signer.publicKey);
    const contract = new Contract(worker.targetContractId);

    const transaction = new TransactionBuilder(source, {
      fee: String(BASE_FEE_STROOPS),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(worker.functionName, ...args))
      .setTimeout(30)
      .build();

    let simulation: SorobanSimulateTransactionResult;
    try {
      simulation = await this.client.simulateTransaction(transaction.toXDR());
    } catch (error) {
      return { status: "aborted", outcome: this.infrastructureFailure(error) };
    }

    if (simulation.error) {
      return { status: "aborted", outcome: this.classifySimulationError(simulation) };
    }

    if (!simulation.transactionData) {
      return {
        status: "aborted",
        outcome: {
          status: "failed",
          reason: "simulation returned no transactionData, so the footprint is unknown",
          retryable: true,
        },
      };
    }

    return { status: "built", transaction, simulation };
  }

  /**
   * Separates "the contract said no" from "the infrastructure broke".
   *
   * The first is an expected, non-retryable outcome that downstream scoring
   * must not read as a miss; the second is worth retrying.
   */
  private classifySimulationError(simulation: SorobanSimulateTransactionResult): SubmissionOutcome {
    const reason = simulation.error ?? "simulation failed without an error message";

    if (CONTRACT_REJECTION.test(reason)) {
      return { status: "contract_rejected", reason, simulation };
    }

    return { status: "failed", reason, retryable: true };
  }

  private infrastructureFailure(error: unknown, hash?: string): SubmissionOutcome {
    if (error instanceof SorobanRpcError) {
      return {
        status: "failed",
        reason: error.message,
        ...(hash !== undefined ? { hash } : {}),
        retryable: error.retryable,
      };
    }

    return {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      ...(hash !== undefined ? { hash } : {}),
      retryable: true,
    };
  }
}
