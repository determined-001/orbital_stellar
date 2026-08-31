import { Keypair, Networks } from "@stellar/stellar-sdk";
import { assertRestrictedSecretNetwork, redactSecret } from "@orbital-stellar/pulse-core";
import type { SecretPolicyContext } from "@orbital-stellar/pulse-core";

/**
 * The one key a worker submitter may sign with: the operator's own.
 *
 * A worker triggers a permissionless contract call. It never holds authority
 * over a subscriber's funds, so it never needs a subscriber's key, and this
 * type is shaped so that giving it one cannot be a quiet change: it wraps
 * exactly one {@link Keypair}, `sign` takes no signer argument, and
 * {@link TxSubmitter} accepts a signer rather than a list of them. Adding a
 * second signer means changing this file's shape - an obvious diff in review.
 *
 * The keypair is held private and never re-exposed; only the public key is
 * readable, and logs get {@link describe}, never the seed.
 */
export class OperatorSigner {
  readonly #keypair: Keypair;

  private constructor(keypair: Keypair) {
    this.#keypair = keypair;
  }

  /**
   * Builds a signer from the operator's secret seed.
   *
   * @param secret - the operator's `S...` seed.
   * @param options.networkPassphrase - the network the process is configured
   *   for. Required so a restricted context can be checked against it.
   * @param options.secretName - name of the variable the secret came from, used
   *   only in errors and logs.
   * @param options.context - set to `"demo"` or `"ci"` when this is a demo or
   *   CI path; the secret policy then refuses a mainnet configuration.
   */
  static fromSecret(
    secret: string,
    options: {
      networkPassphrase: string;
      secretName?: string;
      context?: SecretPolicyContext;
    },
  ): OperatorSigner {
    const secretName = options.secretName ?? "ORBITAL_OPERATOR_SECRET";

    if (!secret) {
      throw new Error(
        `[worker-core] ${secretName} is not set - the submitter has no key to sign with.`,
      );
    }

    if (options.context) {
      assertRestrictedSecretNetwork({
        secretName,
        networkPassphrase: options.networkPassphrase,
        context: options.context,
      });
    }

    let keypair: Keypair;
    try {
      keypair = Keypair.fromSecret(secret);
    } catch {
      // Deliberately does not echo the value, not even a prefix of it.
      throw new Error(`[worker-core] ${secretName} is not a valid Stellar secret seed.`);
    }

    return new OperatorSigner(keypair);
  }

  /**
   * Reads the operator's secret from the environment.
   *
   * Defaults to `ORBITAL_OPERATOR_SECRET`, which is covered by
   * `scripts/assert-no-secrets-in-bundle.mjs`.
   */
  static fromEnv(options: {
    networkPassphrase: string;
    secretName?: string;
    context?: SecretPolicyContext;
    env?: Record<string, string | undefined>;
  }): OperatorSigner {
    const secretName = options.secretName ?? "ORBITAL_OPERATOR_SECRET";
    const env = options.env ?? process.env;
    return OperatorSigner.fromSecret(env[secretName] ?? "", { ...options, secretName });
  }

  /** The operator's account address. Safe to log. */
  get publicKey(): string {
    return this.#keypair.publicKey();
  }

  /** Signs a transaction in place. Takes no signer argument, by design. */
  sign(transaction: { sign(keypair: Keypair): void }): void {
    transaction.sign(this.#keypair);
  }

  /** A log-safe description of this signer. Never includes the seed. */
  describe(): string {
    return `operator ${this.publicKey}`;
  }

  /** Guards against a seed reaching a log through string interpolation or JSON. */
  toString(): string {
    return this.describe();
  }

  toJSON(): string {
    return this.describe();
  }
}

/** Convenience re-export so callers do not need a second stellar-sdk import for the common case. */
export const NETWORK_PASSPHRASE = {
  mainnet: Networks.PUBLIC,
  testnet: Networks.TESTNET,
} as const;

/** Redaction helper, re-exported so worker code has one obvious way to log around secrets. */
export { redactSecret };
