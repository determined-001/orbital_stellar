/**
 * Tests for Paymaster and SponsorshipPolicy.
 *
 * All tests are hermetic — no network calls.  The Stellar SDK's
 * TransactionBuilder / FeeBumpTransaction are used directly so we exercise
 * real XDR round-trips rather than mocking SDK internals.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  TransactionBuilder,
  Keypair,
  Networks,
  Account,
  Operation,
  Asset,
} from "@stellar/stellar-sdk";

import { Paymaster, SelfWrapError, InvalidInnerTransactionError } from "../src/Paymaster.js";
import {
  SponsorshipPolicy,
  RateLimitedError,
  FeeTooHighError,
  FloatExhaustedError,
} from "../src/sponsorshipPolicy.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const NETWORK = Networks.TESTNET;

/** Build and sign a minimal Transaction (one payment op). */
function buildSignedTx(
  signerKp: Keypair,
  opts: { fee?: string; destination?: string } = {},
): ReturnType<typeof TransactionBuilder.prototype.build> {
  const account = new Account(signerKp.publicKey(), "0");
  const destination = opts.destination ?? Keypair.random().publicKey();
  const tx = new TransactionBuilder(account, {
    fee: opts.fee ?? "100",
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount: "1",
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(signerKp);
  return tx;
}

/** Returns base64 XDR of a signed transaction. */
function signedXdr(signerKp: Keypair, opts: { fee?: string; destination?: string } = {}): string {
  return buildSignedTx(signerKp, opts).toEnvelope().toXDR("base64");
}

/** A fresh operator keypair and matching Paymaster with lenient policy. */
function makePaymaster(policy?: ConstructorParameters<typeof SponsorshipPolicy>[0]): {
  paymaster: Paymaster;
  operatorKp: Keypair;
} {
  const operatorKp = Keypair.random();
  const paymaster = new Paymaster({
    operatorKeypair: operatorKp,
    networkPassphrase: NETWORK,
    policy: new SponsorshipPolicy({
      maxBumpsPerUserPerWindow: 100,
      maxFeePerBump: 100_000n,
      dailyXlmCeiling: 1_000,
      ...policy,
    }),
  });
  return { paymaster, operatorKp };
}

// ---------------------------------------------------------------------------
// Paymaster — core construction
// ---------------------------------------------------------------------------

describe("Paymaster.bump — core construction", () => {
  it("returns a valid fee-bump XDR envelope", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();
    const result = paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n });

    expect(typeof result.feeBumpXdr).toBe("string");
    // Must be parseable back to a FeeBumpTransaction
    const parsed = TransactionBuilder.fromXDR(result.feeBumpXdr, NETWORK);
    expect(parsed.constructor.name).toBe("FeeBumpTransaction");
  });

  it("sets the operator address as feeSource on the outer envelope", () => {
    const { paymaster, operatorKp } = makePaymaster();
    const userKp = Keypair.random();
    const result = paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n });

    const parsed = TransactionBuilder.fromXDR(result.feeBumpXdr, NETWORK) as any;
    expect(parsed.feeSource).toBe(operatorKp.publicKey());
  });

  it("exposes the inner source account in the result", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();
    const result = paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n });

    expect(result.innerSource).toBe(userKp.publicKey());
  });

  it("returns a positive totalFeeStroops", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();
    const result = paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n });

    expect(result.totalFeeStroops).toBeGreaterThan(0n);
  });
});

// ---------------------------------------------------------------------------
// Paymaster — inner signature preservation (the byte-identity invariant)
// ---------------------------------------------------------------------------

describe("Paymaster.bump — inner signature preservation", () => {
  it("inner transaction envelope is byte-identical before and after wrapping", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();
    const innerTx = buildSignedTx(userKp);
    const innerXdrBefore = innerTx.toEnvelope().toXDR("base64");

    const result = paymaster.bump({
      innerXdr: innerXdrBefore,
      baseFee: 200n,
    });

    // Extract inner transaction from the fee-bump envelope
    const feeBump = TransactionBuilder.fromXDR(result.feeBumpXdr, NETWORK) as any;
    const innerXdrAfter = feeBump.innerTransaction.toEnvelope().toXDR("base64");

    expect(innerXdrAfter).toBe(innerXdrBefore);
  });

  it("inner signatures count is unchanged after wrapping", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();
    const innerTx = buildSignedTx(userKp);
    const sigsBefore = innerTx.signatures.length;

    const result = paymaster.bump({
      innerXdr: innerTx.toEnvelope().toXDR("base64"),
      baseFee: 200n,
    });

    const feeBump = TransactionBuilder.fromXDR(result.feeBumpXdr, NETWORK) as any;
    expect(feeBump.innerTransaction.signatures.length).toBe(sigsBefore);
  });

  it("outer envelope carries exactly one operator signature", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();
    const result = paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n });

    const feeBump = TransactionBuilder.fromXDR(result.feeBumpXdr, NETWORK) as any;
    // The outer FeeBumpTransactionEnvelope should have exactly 1 signature (operator)
    const outerSigs = feeBump.toEnvelope().feeBump().signatures();
    expect(outerSigs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Paymaster — self-wrap guard
// ---------------------------------------------------------------------------

describe("Paymaster.bump — self-wrap guard", () => {
  it("throws SelfWrapError when inner source is the operator's own account", () => {
    const { paymaster, operatorKp } = makePaymaster();

    // Build an inner tx whose source is the operator
    const innerXdr = signedXdr(operatorKp);

    expect(() => paymaster.bump({ innerXdr, baseFee: 200n })).toThrow(SelfWrapError);
  });

  it("SelfWrapError message includes the operator address", () => {
    const { paymaster, operatorKp } = makePaymaster();
    const innerXdr = signedXdr(operatorKp);

    let err: unknown;
    try {
      paymaster.bump({ innerXdr, baseFee: 200n });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(SelfWrapError);
    expect((err as SelfWrapError).operatorAddress).toBe(operatorKp.publicKey());
    expect((err as SelfWrapError).message).toContain(operatorKp.publicKey());
  });

  it("allows wrapping when inner source is a different account", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();

    expect(() => paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Paymaster — InvalidInnerTransactionError
// ---------------------------------------------------------------------------

describe("Paymaster.bump — invalid inner XDR", () => {
  it("throws InvalidInnerTransactionError for garbage XDR", () => {
    const { paymaster } = makePaymaster();

    expect(() => paymaster.bump({ innerXdr: "not-valid-xdr==", baseFee: 200n })).toThrow(
      InvalidInnerTransactionError,
    );
  });

  it("throws InvalidInnerTransactionError when a FeeBumpTransaction is passed as inner", () => {
    const { paymaster, operatorKp } = makePaymaster();
    const userKp = Keypair.random();

    // Build a fee-bump transaction
    const innerTx = buildSignedTx(userKp);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(operatorKp, "200", innerTx, NETWORK);
    feeBump.sign(operatorKp);
    const feeBumpXdr = feeBump.toEnvelope().toXDR("base64");

    expect(() => paymaster.bump({ innerXdr: feeBumpXdr, baseFee: 200n })).toThrow(
      InvalidInnerTransactionError,
    );
  });

  it("throws InvalidInnerTransactionError when inner has no signatures", () => {
    const { paymaster } = makePaymaster();
    const userKp = Keypair.random();

    // Build but do NOT sign
    const account = new Account(userKp.publicKey(), "0");
    const unsignedTx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: NETWORK,
    })
      .addOperation(
        Operation.payment({
          destination: Keypair.random().publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(30)
      .build();

    const unsignedXdr = unsignedTx.toEnvelope().toXDR("base64");

    expect(() => paymaster.bump({ innerXdr: unsignedXdr, baseFee: 200n })).toThrow(
      InvalidInnerTransactionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Paymaster — policy integration (via spendSnapshot)
// ---------------------------------------------------------------------------

describe("Paymaster.bump — policy enforcement", () => {
  it("throws RateLimitedError when user exceeds per-window bump quota", () => {
    const { paymaster } = makePaymaster({
      maxBumpsPerUserPerWindow: 2,
      windowMs: 60_000,
    });
    const userKp = Keypair.random();

    // First two bumps should succeed
    for (let i = 0; i < 2; i++) {
      paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n }, 1_000);
    }

    // Third must fail
    expect(() => paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n }, 1_000)).toThrow(
      RateLimitedError,
    );
  });

  it("throws FeeTooHighError when baseFee exceeds policy maxFeePerBump", () => {
    const { paymaster } = makePaymaster({ maxFeePerBump: 500n });
    const userKp = Keypair.random();

    expect(() => paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 501n })).toThrow(
      FeeTooHighError,
    );
  });

  it("throws FloatExhaustedError when daily XLM ceiling is reached", () => {
    // Set ceiling absurdly low so first bump exhausts it
    const { paymaster } = makePaymaster({ dailyXlmCeiling: 0.000001 });
    const userKp = Keypair.random();

    // First bump records spend
    paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n }, 1_000);

    // Second bump (different user, same day) should hit the ceiling
    const user2Kp = Keypair.random();
    expect(() => paymaster.bump({ innerXdr: signedXdr(user2Kp), baseFee: 200n }, 1_000)).toThrow(
      FloatExhaustedError,
    );
  });

  it("records spend so spendSnapshot reflects bumps made", () => {
    const { paymaster } = makePaymaster({ dailyXlmCeiling: 100 });
    const userKp = Keypair.random();

    expect(paymaster.spendSnapshot.dailySpentXlm).toBe(0);
    paymaster.bump({ innerXdr: signedXdr(userKp), baseFee: 200n });
    expect(paymaster.spendSnapshot.dailySpentXlm).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SponsorshipPolicy — unit tests
// ---------------------------------------------------------------------------

describe("SponsorshipPolicy", () => {
  let policy: SponsorshipPolicy;

  beforeEach(() => {
    policy = new SponsorshipPolicy({
      maxBumpsPerUserPerWindow: 3,
      windowMs: 60_000,
      maxFeePerBump: 10_000n,
      dailyXlmCeiling: 10,
    });
  });

  // ── rate limiting ────────────────────────────────────────────────────────

  it("allows bumps up to the per-window quota", () => {
    for (let i = 0; i < 3; i++) {
      expect(() =>
        policy.check({ userId: "user-A", requestedBaseFee: 100n }, 1_000 + i),
      ).not.toThrow();
      policy.record({ userId: "user-A", totalFeeStroops: 200n }, 1_000 + i);
    }
  });

  it("blocks the bump that would exceed the quota in the same window", () => {
    for (let i = 0; i < 3; i++) {
      policy.check({ userId: "user-B", requestedBaseFee: 100n }, 1_000);
      policy.record({ userId: "user-B", totalFeeStroops: 200n }, 1_000);
    }
    expect(() => policy.check({ userId: "user-B", requestedBaseFee: 100n }, 1_000)).toThrow(
      RateLimitedError,
    );
  });

  it("resets the quota for a user after the window expires", () => {
    for (let i = 0; i < 3; i++) {
      policy.check({ userId: "user-C", requestedBaseFee: 100n }, 0);
      policy.record({ userId: "user-C", totalFeeStroops: 200n }, 0);
    }

    // 61 seconds later — window has rolled over
    expect(() => policy.check({ userId: "user-C", requestedBaseFee: 100n }, 61_000)).not.toThrow();
  });

  it("RateLimitedError exposes retryAfterMs > 0", () => {
    for (let i = 0; i < 3; i++) {
      policy.check({ userId: "user-D", requestedBaseFee: 100n }, 0);
      policy.record({ userId: "user-D", totalFeeStroops: 200n }, 0);
    }

    let err!: RateLimitedError;
    try {
      policy.check({ userId: "user-D", requestedBaseFee: 100n }, 30_000);
    } catch (e) {
      err = e as RateLimitedError;
    }

    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.retryAfterMs).toBeGreaterThan(0);
    expect(err.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it("rate limits are per-user — other users are not affected", () => {
    for (let i = 0; i < 3; i++) {
      policy.check({ userId: "user-E", requestedBaseFee: 100n }, 0);
      policy.record({ userId: "user-E", totalFeeStroops: 200n }, 0);
    }

    // A different user should still be allowed
    expect(() => policy.check({ userId: "user-F", requestedBaseFee: 100n }, 0)).not.toThrow();
  });

  // ── fee cap ──────────────────────────────────────────────────────────────

  it("allows baseFee exactly equal to maxFeePerBump", () => {
    expect(() => policy.check({ userId: "user-G", requestedBaseFee: 10_000n })).not.toThrow();
  });

  it("blocks baseFee one stroop above maxFeePerBump", () => {
    expect(() => policy.check({ userId: "user-G", requestedBaseFee: 10_001n })).toThrow(
      FeeTooHighError,
    );
  });

  it("FeeTooHighError exposes requestedFee and maxFee", () => {
    let err!: FeeTooHighError;
    try {
      policy.check({ userId: "user-H", requestedBaseFee: 99_999n });
    } catch (e) {
      err = e as FeeTooHighError;
    }
    expect(err).toBeInstanceOf(FeeTooHighError);
    expect(err.requestedFee).toBe(99_999n);
    expect(err.maxFee).toBe(10_000n);
  });

  // ── daily float ──────────────────────────────────────────────────────────

  it("allows spending up to but not reaching the ceiling", () => {
    // 10 XLM ceiling; 9_999_999 stroops = 0.9999999 XLM — well under
    policy.record({ userId: "any", totalFeeStroops: 99_999_990n }, 0);
    expect(() => policy.check({ userId: "user-I", requestedBaseFee: 100n }, 0)).not.toThrow();
  });

  it("throws FloatExhaustedError when ceiling is reached", () => {
    // Spend exactly the ceiling
    policy.record({ userId: "any", totalFeeStroops: BigInt(10 * 10_000_000) }, 0);
    expect(() => policy.check({ userId: "user-J", requestedBaseFee: 100n }, 0)).toThrow(
      FloatExhaustedError,
    );
  });

  it("FloatExhaustedError exposes dailySpentXlm and ceilingXlm", () => {
    policy.record({ userId: "any", totalFeeStroops: BigInt(10 * 10_000_000) }, 0);

    let err!: FloatExhaustedError;
    try {
      policy.check({ userId: "user-K", requestedBaseFee: 100n }, 0);
    } catch (e) {
      err = e as FloatExhaustedError;
    }

    expect(err).toBeInstanceOf(FloatExhaustedError);
    expect(err.ceilingXlm).toBe(10);
    expect(err.dailySpentXlm).toBeCloseTo(10, 5);
  });

  it("resets daily spend counter at UTC midnight", () => {
    // Exhaust the float on day 1
    policy.record({ userId: "any", totalFeeStroops: BigInt(10 * 10_000_000) }, 0);

    // Simulate day 2: any time strictly after UTC midnight
    const day2 = new Date("2026-01-02T00:00:00.000Z").getTime();
    expect(() => policy.check({ userId: "user-L", requestedBaseFee: 100n }, day2)).not.toThrow();
  });

  it("dailySpentXlm reflects recorded spend", () => {
    expect(policy.dailySpentXlm).toBe(0);
    policy.record({ userId: "any", totalFeeStroops: 10_000_000n }, 0);
    expect(policy.dailySpentXlm).toBeCloseTo(1, 5);
  });
});
