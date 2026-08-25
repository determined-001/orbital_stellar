import { describe, it, expect, vi } from "vitest";
// Test-only: building a genuine challenge needs a server keypair, which is
// exactly the key material the SDK itself refuses to handle. `WebAuth` comes
// through pulse-core the same way src/sep10.ts consumes it.
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { WebAuth } from "@orbital-stellar/pulse-core";
import { Sep10Client, Sep10AuthError } from "../src/sep10.js";

const HOME_DOMAIN = "anchor.example";
const WEB_AUTH_DOMAIN = "auth.anchor.example";
const ENDPOINT = `https://${WEB_AUTH_DOMAIN}/auth`;

const serverKeypair = Keypair.random();
const clientKeypair = Keypair.random();

/** A genuine SEP-10 challenge from `serverKeypair`, as a real anchor would issue. */
function buildChallenge(
  overrides: {
    server?: Keypair;
    homeDomain?: string;
    webAuthDomain?: string;
    network?: string;
  } = {},
): string {
  return WebAuth.buildChallengeTx(
    overrides.server ?? serverKeypair,
    clientKeypair.publicKey(),
    overrides.homeDomain ?? HOME_DOMAIN,
    300,
    overrides.network ?? Networks.TESTNET,
    overrides.webAuthDomain ?? WEB_AUTH_DOMAIN,
  );
}

function makeClient(challengeXdr: string, sign: ReturnType<typeof vi.fn>) {
  const transport = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({ token: "jwt.token.here" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ transaction: challengeXdr, network_passphrase: Networks.TESTNET }),
      { status: 200 },
    );
  });

  const client = new Sep10Client(ENDPOINT, {
    serverAccountId: serverKeypair.publicKey(),
    networkPassphrase: Networks.TESTNET,
    homeDomain: HOME_DOMAIN,
    webAuthDomain: WEB_AUTH_DOMAIN,
    transport: transport as unknown as typeof fetch,
  });

  return { client, transport, sign };
}

/** Signs the challenge the way a real wallet would. */
const honestSigner = () =>
  vi.fn((challenge: { transaction: string }) => {
    const tx = WebAuth.readChallengeTx(
      challenge.transaction,
      serverKeypair.publicKey(),
      Networks.TESTNET,
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN,
    ).tx;
    tx.sign(clientKeypair);
    return tx.toXDR();
  });

describe("Sep10Client construction", () => {
  const validOptions = {
    serverAccountId: serverKeypair.publicKey(),
    networkPassphrase: Networks.TESTNET,
    homeDomain: HOME_DOMAIN,
    webAuthDomain: WEB_AUTH_DOMAIN,
  };

  it("rejects a non-https endpoint", () => {
    expect(() => new Sep10Client(`http://${WEB_AUTH_DOMAIN}/auth`, validOptions)).toThrow(
      Sep10AuthError,
    );
  });

  it("requires serverAccountId, the only way to attribute a challenge", () => {
    expect(() => new Sep10Client(ENDPOINT, { ...validOptions, serverAccountId: "" })).toThrow(
      /serverAccountId is required/,
    );
  });

  it("requires networkPassphrase, homeDomain and webAuthDomain", () => {
    expect(() => new Sep10Client(ENDPOINT, { ...validOptions, networkPassphrase: "" })).toThrow(
      /networkPassphrase is required/,
    );
    expect(() => new Sep10Client(ENDPOINT, { ...validOptions, homeDomain: "" })).toThrow(
      /homeDomain is required/,
    );
    expect(() => new Sep10Client(ENDPOINT, { ...validOptions, homeDomain: [] })).toThrow(
      /homeDomain is required/,
    );
    expect(() => new Sep10Client(ENDPOINT, { ...validOptions, webAuthDomain: "" })).toThrow(
      /webAuthDomain is required/,
    );
  });
});

describe("Sep10Client.fromToml", () => {
  const toml = {
    WEB_AUTH_ENDPOINT: ENDPOINT,
    SIGNING_KEY: serverKeypair.publicKey(),
    NETWORK_PASSPHRASE: Networks.TESTNET,
  };

  it("wires SIGNING_KEY through as the challenge verification key", () => {
    const client = Sep10Client.fromToml(toml, HOME_DOMAIN);
    expect(() => client.verifyChallenge({ transaction: buildChallenge() })).not.toThrow();
  });

  it("refuses to build a client when the anchor publishes no SIGNING_KEY", () => {
    expect(() => Sep10Client.fromToml({ ...toml, SIGNING_KEY: undefined }, HOME_DOMAIN)).toThrow(
      /no SIGNING_KEY/,
    );
  });

  it("refuses when the toml has no WEB_AUTH_ENDPOINT", () => {
    expect(() =>
      Sep10Client.fromToml({ ...toml, WEB_AUTH_ENDPOINT: undefined }, HOME_DOMAIN),
    ).toThrow(/no WEB_AUTH_ENDPOINT/);
  });

  it("refuses when the network cannot be determined", () => {
    expect(() =>
      Sep10Client.fromToml({ ...toml, NETWORK_PASSPHRASE: undefined }, HOME_DOMAIN),
    ).toThrow(/no NETWORK_PASSPHRASE/);
  });
});

describe("Sep10Client.authenticate - challenge validation before signing", () => {
  it("authenticates against a genuine challenge", async () => {
    const sign = honestSigner();
    const { client } = makeClient(buildChallenge(), sign);

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).resolves.toBe(
      "jwt.token.here",
    );
    expect(sign).toHaveBeenCalledOnce();
  });

  it("regression (HIGH-1): a challenge signed by the WRONG key never reaches the signer", async () => {
    // The core attack: anything the signer receives can be signed and broadcast,
    // so an impostor's transaction must be rejected before `sign` is called.
    const impostor = Keypair.random();
    const sign = honestSigner();
    const { client } = makeClient(buildChallenge({ server: impostor }), sign);

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).rejects.toThrow(
      Sep10AuthError,
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects a challenge for a different home domain without signing", async () => {
    const sign = honestSigner();
    const { client } = makeClient(buildChallenge({ homeDomain: "evil.example" }), sign);

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).rejects.toThrow(
      Sep10AuthError,
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects a challenge built for another network without signing", async () => {
    const sign = honestSigner();
    const { client } = makeClient(buildChallenge({ network: Networks.PUBLIC }), sign);

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).rejects.toThrow(
      Sep10AuthError,
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects a mismatched advertised network_passphrase without signing", async () => {
    const sign = honestSigner();
    const transport = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            transaction: buildChallenge(),
            network_passphrase: Networks.PUBLIC,
          }),
          { status: 200 },
        ),
    );
    const client = new Sep10Client(ENDPOINT, {
      serverAccountId: serverKeypair.publicKey(),
      networkPassphrase: Networks.TESTNET,
      homeDomain: HOME_DOMAIN,
      webAuthDomain: WEB_AUTH_DOMAIN,
      transport: transport as unknown as typeof fetch,
    });

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).rejects.toThrow(
      /expected "Test SDF Network ; September 2015"/,
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects a challenge with the wrong web_auth_domain without signing", async () => {
    const sign = honestSigner();
    const { client } = makeClient(buildChallenge({ webAuthDomain: "phish.example" }), sign);

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).rejects.toThrow(
      Sep10AuthError,
    );
    expect(sign).not.toHaveBeenCalled();
  });

  it("rejects garbage XDR without signing", async () => {
    const sign = honestSigner();
    const { client } = makeClient("not-valid-base64-xdr", sign);

    await expect(client.authenticate({ account: clientKeypair.publicKey(), sign })).rejects.toThrow(
      Sep10AuthError,
    );
    expect(sign).not.toHaveBeenCalled();
  });
});

// Previously in test/sep24.test.ts, where they drove authenticate() with
// placeholder XDR ("AAAA-challenge"). That only passed because nothing checked
// the challenge; they belong here now that a real one is required.
describe("Sep10Client.authenticate - handshake mechanics", () => {
  it("runs challenge -> sign -> token and posts the signed XDR", async () => {
    const sign = honestSigner();
    const { client, transport } = makeClient(buildChallenge(), sign);

    const token = await client.authenticate({ account: clientKeypair.publicKey(), sign });

    expect(token).toBe("jwt.token.here");
    const challengeCall = transport.mock.calls[0]!;
    expect(challengeCall[0]).toContain(`account=${clientKeypair.publicKey()}`);

    const postCall = transport.mock.calls[1]!;
    const posted = JSON.parse(String(postCall[1]?.body)) as { transaction: string };
    expect(posted.transaction).toBe(sign.mock.results[0]!.value);
  });

  it("never asks for key material - signing stays delegated", async () => {
    // The SDK only ever sees XDR; the secret lives behind the callback.
    const hsm = vi.fn((challenge: { transaction: string }) => {
      const { tx } = WebAuth.readChallengeTx(
        challenge.transaction,
        serverKeypair.publicKey(),
        Networks.TESTNET,
        HOME_DOMAIN,
        WEB_AUTH_DOMAIN,
      );
      tx.sign(clientKeypair);
      return tx.toXDR();
    });
    const { client } = makeClient(buildChallenge(), hsm);

    await expect(
      client.authenticate({ account: clientKeypair.publicKey(), sign: hsm }),
    ).resolves.toBe("jwt.token.here");
    expect(hsm).toHaveBeenCalledOnce();
  });

  it("rejects an empty signature instead of posting it", async () => {
    const emptySigner = vi.fn(() => "");
    const { client, transport } = makeClient(buildChallenge(), emptySigner);

    await expect(
      client.authenticate({ account: clientKeypair.publicKey(), sign: emptySigner }),
    ).rejects.toBeInstanceOf(Sep10AuthError);
    // Challenge fetched, nothing posted back.
    expect(transport.mock.calls).toHaveLength(1);
  });
});
