import { NETWORK_PASSPHRASES } from "./index.js";

/**
 * Startup guard for signing keys.
 *
 * Demo surfaces and CI are the two places where a key with real value must
 * never end up: the demo invoker is exposed to anonymous visitors through a
 * button, and CI secrets are readable by every workflow that runs. Both are
 * scoped to testnet by design, so a mainnet configuration in either is a
 * misconfiguration, and the safe response is to refuse to start rather than to
 * sign something.
 *
 * The check is on *configuration*, not on the key itself - a Stellar secret
 * seed carries no network marker, so "is this a mainnet key" is unknowable
 * from the string. What is knowable is which network the process is pointed
 * at, and that is what this refuses.
 */

/** Thrown when a signing key would be used against mainnet from a demo or CI path. */
export class MainnetSecretInRestrictedPathError extends Error {
  constructor(
    public readonly secretName: string,
    public readonly context: SecretPolicyContext,
  ) {
    super(
      `[pulse-core] refusing to use ${secretName} in a ${context} path configured for mainnet. ` +
        `Demo and CI signing keys are testnet-only - point the process at testnet, or use a key ` +
        `that is not ${secretName}.`,
    );
    this.name = "MainnetSecretInRestrictedPathError";
  }
}

/** Where the secret is about to be used. */
export type SecretPolicyContext = "demo" | "ci";

export type AssertRestrictedSecretOptions = {
  /** Name of the environment variable holding the secret, for the message. */
  secretName: string;
  /** Network passphrase the process is configured with. */
  networkPassphrase: string;
  /** Which restricted path this is. */
  context: SecretPolicyContext;
};

/**
 * Refuses a signing key configured against mainnet in a demo or CI path.
 *
 * @throws {MainnetSecretInRestrictedPathError} when `networkPassphrase` is the
 *   mainnet passphrase.
 *
 * @example
 * assertRestrictedSecretNetwork({
 *   secretName: "DEMO_EMITTER_SECRET",
 *   networkPassphrase: Networks.TESTNET,
 *   context: "demo",
 * });
 */
export function assertRestrictedSecretNetwork(options: AssertRestrictedSecretOptions): void {
  if (options.networkPassphrase === NETWORK_PASSPHRASES.mainnet) {
    throw new MainnetSecretInRestrictedPathError(options.secretName, options.context);
  }
}

/** Whether the process looks like a CI runner. */
export function isCiEnvironment(env: Record<string, string | undefined> = process.env): boolean {
  return env.CI === "true" || env.CI === "1" || env.GITHUB_ACTIONS === "true";
}

/**
 * Redacts a secret for logging: keeps enough to correlate with a rotation
 * record, never enough to use.
 *
 * Anything shorter than 12 characters is redacted whole - a short "secret" is
 * either not one, or too small to reveal safely.
 */
export function redactSecret(secret: string | undefined | null): string {
  if (!secret) return "<unset>";
  if (secret.length < 12) return "<redacted>";
  return `${secret.slice(0, 4)}…${secret.slice(-2)} (${secret.length} chars)`;
}
