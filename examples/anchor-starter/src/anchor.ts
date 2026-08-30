import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  discoverAnchor,
  Sep10Client,
  Sep24Client,
  Sep31Client,
  type ChallengeSigner,
  type StellarToml,
} from "@orbital-stellar/anchor-sdk";
import type { StarterConfig } from "./config.js";

/** Everything needed to talk to one anchor for the rest of a session. */
export type AnchorSession = {
  toml: StellarToml;
  publicKey: string;
  /** SEP-10 session JWT. Required by every SEP-24/31 call after this. */
  token: string;
  sep24?: Sep24Client;
  sep31?: Sep31Client;
};

/**
 * Signs a SEP-10 challenge with a local {@link Keypair}. `anchor-sdk` never
 * touches key material itself (see `Sep10Client`'s module doc) - this is the
 * one place in the starter that does, and it exists specifically to be swapped
 * out for a hardware wallet or KMS call in a real deployment.
 *
 * `networkPassphrase` is the starter's own configured network, not read from
 * the challenge: `Sep10Client.verifyChallenge` already rejects a challenge
 * whose `network_passphrase` disagrees with it, and the field is optional on
 * the wire, so signing must not depend on the anchor having echoed it back.
 */
export function keypairSigner(keypair: Keypair, networkPassphrase: string): ChallengeSigner {
  return (challenge) => {
    const tx = TransactionBuilder.fromXDR(challenge.transaction, networkPassphrase);
    tx.sign(keypair);
    return tx.toXDR();
  };
}

/**
 * SEP-1 discovery + SEP-10 authentication, in one call: the shared first step
 * of every command this starter offers.
 */
export async function connect(config: StarterConfig): Promise<AnchorSession> {
  const toml = await discoverAnchor(config.homeDomain);
  const keypair = Keypair.fromSecret(config.secret);
  const networkPassphrase = config.network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

  const sep10 = Sep10Client.fromToml(toml, config.homeDomain, { networkPassphrase });
  const token = await sep10.authenticate({
    account: keypair.publicKey(),
    sign: keypairSigner(keypair, networkPassphrase),
  });

  return {
    toml,
    publicKey: keypair.publicKey(),
    token,
    sep24: toml.TRANSFER_SERVER_SEP0024 ? new Sep24Client(toml.TRANSFER_SERVER_SEP0024) : undefined,
    sep31: toml.DIRECT_PAYMENT_SERVER ? new Sep31Client(toml.DIRECT_PAYMENT_SERVER) : undefined,
  };
}
