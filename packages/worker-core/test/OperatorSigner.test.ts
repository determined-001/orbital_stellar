import { describe, expect, it } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { MainnetSecretInRestrictedPathError } from "@orbital-stellar/pulse-core";

import { OperatorSigner } from "../src/OperatorSigner.js";

const OPERATOR = Keypair.random();

describe("OperatorSigner", () => {
  it("signs with exactly the operator's key", () => {
    const signer = OperatorSigner.fromSecret(OPERATOR.secret(), {
      networkPassphrase: Networks.TESTNET,
    });

    expect(signer.publicKey).toBe(OPERATOR.publicKey());

    // `sign` takes the transaction only. There is no parameter through which a
    // second signer could be passed, which is the point of the type.
    expect(signer.sign.length).toBe(1);
  });

  it("keeps the seed out of every string form of the signer", () => {
    const signer = OperatorSigner.fromSecret(OPERATOR.secret(), {
      networkPassphrase: Networks.TESTNET,
    });

    const rendered = [
      String(signer),
      JSON.stringify(signer),
      signer.describe(),
      JSON.stringify({ signer }),
    ];

    for (const text of rendered) {
      expect(text).not.toContain(OPERATOR.secret());
      expect(text).toContain(OPERATOR.publicKey());
    }
  });

  it("refuses a mainnet-configured demo or CI path through the secret policy", () => {
    expect(() =>
      OperatorSigner.fromSecret(OPERATOR.secret(), {
        networkPassphrase: Networks.PUBLIC,
        context: "ci",
        secretName: "ORBITAL_OPERATOR_SECRET",
      }),
    ).toThrow(MainnetSecretInRestrictedPathError);

    // ...and allows the same key on testnet.
    expect(() =>
      OperatorSigner.fromSecret(OPERATOR.secret(), {
        networkPassphrase: Networks.TESTNET,
        context: "ci",
      }),
    ).not.toThrow();
  });

  it("reads the operator secret from the environment without echoing it", () => {
    const signer = OperatorSigner.fromEnv({
      networkPassphrase: Networks.TESTNET,
      env: { ORBITAL_OPERATOR_SECRET: OPERATOR.secret() },
    });

    expect(signer.publicKey).toBe(OPERATOR.publicKey());
  });

  it("fails loudly when the secret is unset or malformed, quoting neither", () => {
    expect(() => OperatorSigner.fromEnv({ networkPassphrase: Networks.TESTNET, env: {} })).toThrow(
      /ORBITAL_OPERATOR_SECRET is not set/,
    );

    try {
      OperatorSigner.fromSecret("SNOTAREALSEED", { networkPassphrase: Networks.TESTNET });
      expect.unreachable("expected an invalid-seed error");
    } catch (error) {
      expect((error as Error).message).not.toContain("SNOTAREALSEED");
      expect((error as Error).message).toContain("not a valid Stellar secret seed");
    }
  });
});
