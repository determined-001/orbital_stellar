/**
 * Fee-bump Paymaster for Orbital workers.
 *
 * ## What this does
 *
 * Wraps a user-signed inner transaction in a Stellar fee-bump envelope so that
 * the operator pays the network fee on the user's behalf. The operator provides
 * XLM for the fee and **nothing else** — no signing authority over anything
 * inside the inner transaction is granted or required.
 *
 * ## What this never does
 *
 * - The paymaster **never** holds, transfers, or custodies user assets.
 * - The paymaster **never** requires or inspects the user's signing key.
 * - The paymaster **never** wraps a transaction whose source is the operator's
 *   own account (that would let a caller use the paymaster as a proxy signer).
 * - If any of those invariants would be broken, construction throws
 *   immediately with a typed, alertable error.
 *
 * ## Security model
 *
 * See `docs/design/worker-paymaster.md` for the full threat model and the
 * rationale for each restriction.
 *
 * ## Usage
 *
 * ```ts
 * const paymaster = new Paymaster({
 *   operatorKeypair: Keypair.fromSecret(process.env.OPERATOR_SECRET!),
 *   networkPassphrase: Networks.TESTNET,
 *   policy: new SponsorshipPolicy({ dailyXlmCeiling: 50 }),
 * });
 *
 * // Accept an XDR envelope string from the user
 * const result = await paymaster.bump({
 *   innerXdr: userSignedEnvelope,
 *   baseFee: 200n,
 * });
 *
 * // Submit result.feeBumpXdr to Horizon
 * ```
 */

import { TransactionBuilder, Keypair, type Transaction } from "@stellar/stellar-sdk";
import { SponsorshipPolicy, type SponsorshipPolicyConfig } from "./sponsorshipPolicy.js";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Raised when the inner transaction's source account matches the operator's
 * own account.  Wrapping such a transaction would let an untrusted caller
 * use the paymaster as a proxy signer for the operator — this is strictly
 * forbidden.
 */
export class SelfWrapError extends Error {
  readonly name = "SelfWrapError" as const;
  constructor(public readonly operatorAddress: string) {
    super(
      `[paymaster] refused to wrap an inner transaction whose source is the operator account ` +
        `(${operatorAddress}). Wrapping the operator's own transactions is not permitted.`,
    );
  }
}

/**
 * Raised when the provided XDR cannot be parsed as a valid Stellar
 * transaction envelope.
 */
export class InvalidInnerTransactionError extends Error {
  readonly name = "InvalidInnerTransactionError" as const;
  constructor(
    public readonly reason: string,
    public readonly cause?: unknown,
  ) {
    super(`[paymaster] invalid inner transaction: ${reason}`);
  }
}

// Re-export policy errors so callers only import from one place
export { RateLimitedError, FeeTooHighError, FloatExhaustedError } from "./sponsorshipPolicy.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PaymasterConfig {
  /**
   * The operator's keypair.  The public key becomes the fee-bump `feeSource`;
   * the secret key is used to sign the outer envelope.
   *
   * **This keypair must never be the same as any user keypair.**
   */
  operatorKeypair: Keypair;

  /**
   * Stellar network passphrase (e.g. `Networks.TESTNET` or `Networks.PUBLIC`).
   * Must match the passphrase embedded in the inner transaction.
   */
  networkPassphrase: string;

  /**
   * Spend-control policy.  You may pass an already-constructed
   * {@link SponsorshipPolicy} instance or a raw config object.  When omitted,
   * a policy with conservative defaults is created automatically.
   */
  policy?: SponsorshipPolicy | SponsorshipPolicyConfig;
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface BumpInput {
  /**
   * Base64-encoded XDR of the user's signed transaction envelope.
   * This envelope must contain at least one signature and at least one
   * operation.
   */
  innerXdr: string;

  /**
   * Base fee per operation (in stroops) the operator is willing to pay.
   * Must be ≥ 100 (BASE_FEE) and must satisfy the policy's `maxFeePerBump`
   * ceiling.
   */
  baseFee: bigint;
}

export interface BumpResult {
  /**
   * Base64-encoded XDR of the signed fee-bump envelope, ready to submit to
   * Horizon (`POST /transactions`).
   */
  feeBumpXdr: string;

  /**
   * The total fee paid by the operator in stroops (= baseFee × (innerOps + 1)).
   * Use this for accounting and to drive `policy.record()`.
   */
  totalFeeStroops: bigint;

  /**
   * The source account of the inner transaction (the user's account).
   * Useful for routing and audit logging.
   */
  innerSource: string;
}

// ---------------------------------------------------------------------------
// Paymaster
// ---------------------------------------------------------------------------

export class Paymaster {
  readonly #keypair: Keypair;
  readonly #network: string;
  readonly #policy: SponsorshipPolicy;

  constructor(config: PaymasterConfig) {
    this.#keypair = config.operatorKeypair;
    this.#network = config.networkPassphrase;

    if (config.policy instanceof SponsorshipPolicy) {
      this.#policy = config.policy;
    } else {
      this.#policy = new SponsorshipPolicy(config.policy ?? {});
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Wraps a user-signed inner transaction in a fee-bump envelope and signs it
   * with the operator keypair.
   *
   * The method:
   * 1. Parses and validates the inner XDR.
   * 2. Refuses if the inner source is the operator's own account.
   * 3. Runs all three spend-control policy checks (rate limit, fee cap, float).
   * 4. Builds and operator-signs the fee-bump envelope.
   * 5. Records the spend with the policy.
   * 6. Returns the signed envelope XDR and accounting metadata.
   *
   * @throws {InvalidInnerTransactionError} if `innerXdr` cannot be parsed.
   * @throws {SelfWrapError} if the inner source equals the operator address.
   * @throws {RateLimitedError} if the user has hit their per-window quota.
   * @throws {FeeTooHighError} if `baseFee` exceeds the configured ceiling.
   * @throws {FloatExhaustedError} if today's daily XLM ceiling is exhausted.
   */
  bump(input: BumpInput, nowMs = Date.now()): BumpResult {
    // 1. Parse inner transaction
    const innerTx = this.#parseInner(input.innerXdr);

    // 2. Refuse self-wrap
    const operatorAddress = this.#keypair.publicKey();
    if (innerTx.source === operatorAddress) {
      throw new SelfWrapError(operatorAddress);
    }

    const userId = innerTx.source;

    // 3. Policy checks (throws on any violation)
    this.#policy.check({ userId, requestedBaseFee: input.baseFee }, nowMs);

    // 4. Build fee-bump envelope
    //    TransactionBuilder.buildFeeBumpTransaction takes baseFee as a string
    //    (stroops per operation) and accepts a Keypair as feeSource.
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      this.#keypair,
      input.baseFee.toString(),
      innerTx,
      this.#network,
    );

    // Sign the outer envelope with the operator key only.
    // The inner transaction's signatures are preserved untouched by the SDK —
    // they live inside the immutable innerTx envelope.
    feeBump.sign(this.#keypair);

    const feeBumpXdr = feeBump.toEnvelope().toXDR("base64");

    // Compute total fee for accounting
    // SDK sets fee = baseFee × (innerOps + 1) + any Soroban resource fee.
    // We read it back from the built envelope for accuracy.
    const totalFeeStroops = BigInt(feeBump.fee);

    // 5. Record spend (after successful construction, before returning)
    this.#policy.record({ userId, totalFeeStroops }, nowMs);

    return {
      feeBumpXdr,
      totalFeeStroops,
      innerSource: userId,
    };
  }

  /**
   * The operator's public key (the fee-bump `feeSource`).
   */
  get operatorAddress(): string {
    return this.#keypair.publicKey();
  }

  /**
   * A snapshot of today's spend for health checks and metrics.
   */
  get spendSnapshot(): { dailySpentXlm: number; dailyXlmCeiling: number } {
    return {
      dailySpentXlm: this.#policy.dailySpentXlm,
      dailyXlmCeiling: this.#policy.dailyXlmCeiling,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #parseInner(xdr: string): Transaction {
    let parsed: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      parsed = TransactionBuilder.fromXDR(xdr, this.#network);
    } catch (err) {
      throw new InvalidInnerTransactionError(
        "XDR could not be parsed as a Stellar transaction envelope",
        err,
      );
    }

    // Fee-bump-of-fee-bump is not permitted by the protocol (§C.2 rule 2).
    // TransactionBuilder.fromXDR returns FeeBumpTransaction for fee-bump XDR.
    // We check the constructor name because FeeBumpTransaction is not exported
    // from all SDK entry points, and instanceof checks across module instances
    // are unreliable.
    if (parsed.constructor.name === "FeeBumpTransaction") {
      throw new InvalidInnerTransactionError(
        "inner transaction must be a regular Transaction, not a FeeBumpTransaction " +
          "(nesting fee bumps is not permitted by the Stellar protocol)",
      );
    }

    const tx = parsed as Transaction;

    if (tx.operations.length === 0) {
      throw new InvalidInnerTransactionError(
        "inner transaction has no operations; fee-bump requires at least one",
      );
    }

    if (tx.signatures.length === 0) {
      throw new InvalidInnerTransactionError(
        "inner transaction has no signatures; the user must sign before the paymaster wraps",
      );
    }

    return tx;
  }
}
