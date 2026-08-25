import { z } from "zod";
import { WebAuth } from "@orbital-stellar/pulse-core";
import type { StellarToml } from "./sep1.js";
import { stripTrailingSlashes } from "./strings.js";

/**
 * SEP-10 authentication: fetch a challenge transaction, sign it, exchange it
 * for a JWT.
 *
 * Signing is delegated to a caller-supplied callback rather than taking a
 * secret key. This package never holds key material: a consumer can sign with
 * a hardware wallet, a KMS, or `Keypair.sign` - the SDK only sees the signed
 * XDR that comes back.
 *
 * That delegation is only safe if the challenge is checked first. Not holding
 * the key does not reduce the risk of signing the wrong transaction, it just
 * moves the risk to whoever does hold it. So `Sep10Client` validates every
 * challenge against the anchor's `SIGNING_KEY` before the signer ever sees it -
 * see `verifyChallenge`.
 */

/** Thrown when the anchor rejects the challenge or returns an unusable one. */
export class Sep10AuthError extends Error {
  constructor(reason: string) {
    super(`[anchor-sdk] SEP-10 authentication failed: ${reason}`);
    this.name = "Sep10AuthError";
  }
}

export const Sep10ChallengeSchema = z.object({
  transaction: z.string(),
  network_passphrase: z.string().optional(),
});

export type Sep10Challenge = z.infer<typeof Sep10ChallengeSchema>;

const Sep10TokenSchema = z.object({ token: z.string() });

/**
 * Signs the challenge XDR and returns the signed XDR. Implementations must not
 * mutate the challenge other than adding their signature.
 */
export type ChallengeSigner = (challenge: Sep10Challenge) => Promise<string> | string;

export type Sep10ClientOptions = {
  /**
   * The anchor's `SIGNING_KEY` from its `stellar.toml` (see `discoverAnchor`).
   * The challenge must carry a valid signature from this key or it is not the
   * anchor's challenge and must never reach the signer.
   */
  serverAccountId: string;
  /** Expected network passphrase, e.g. `Networks.TESTNET`. */
  networkPassphrase: string;
  /**
   * Home domain(s) expected in the challenge's first Manage Data key. Pass an
   * array when an anchor serves several.
   */
  homeDomain: string | string[];
  /** Domain expected as the value of the `web_auth_domain` Manage Data entry. */
  webAuthDomain: string;
  /** Transport override; defaults to the global `fetch`. */
  transport?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Request timeout in milliseconds. Defaults to 10 000. */
  timeoutMs?: number;
};

export type Sep10AuthenticateParams = {
  /** The Stellar account authenticating. */
  account: string;
  /** Optional memo for shared-account authentication. */
  memo?: string;
  /** Client home domain, when the anchor requires one. */
  clientDomain?: string;
  /** Callback that signs the challenge transaction. */
  sign: ChallengeSigner;
};

export class Sep10Client {
  private readonly webAuthEndpoint: string;
  private readonly serverAccountId: string;
  private readonly networkPassphrase: string;
  private readonly homeDomain: string | string[];
  private readonly webAuthDomain: string;
  private readonly transport: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  constructor(webAuthEndpoint: string, options: Sep10ClientOptions) {
    // The challenge we are about to sign arrives over this connection. Without
    // TLS an on-path attacker chooses the transaction, so refuse rather than
    // authenticate over cleartext.
    if (!/^https:\/\//i.test(webAuthEndpoint)) {
      throw new Sep10AuthError(`WEB_AUTH_ENDPOINT must be https, got "${webAuthEndpoint}"`);
    }
    if (!options?.serverAccountId) {
      throw new Sep10AuthError(
        "serverAccountId is required - it is the anchor's SIGNING_KEY and the only way to prove a challenge came from the anchor",
      );
    }
    if (!options.networkPassphrase) {
      throw new Sep10AuthError("networkPassphrase is required");
    }
    if (!options.homeDomain || (Array.isArray(options.homeDomain) && !options.homeDomain.length)) {
      throw new Sep10AuthError("homeDomain is required");
    }
    if (!options.webAuthDomain) {
      throw new Sep10AuthError("webAuthDomain is required");
    }

    this.webAuthEndpoint = stripTrailingSlashes(webAuthEndpoint);
    this.serverAccountId = options.serverAccountId;
    this.networkPassphrase = options.networkPassphrase;
    this.homeDomain = options.homeDomain;
    this.webAuthDomain = options.webAuthDomain;
    this.transport = options.transport ?? fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Builds a client from a `stellar.toml` fetched with `discoverAnchor`, taking
   * `WEB_AUTH_ENDPOINT`, `SIGNING_KEY` and `NETWORK_PASSPHRASE` from it.
   *
   * Prefer this over the constructor: it is the path that cannot forget to pass
   * `SIGNING_KEY`, without which no challenge can be attributed to the anchor.
   *
   * @param toml - Parsed `stellar.toml` for `homeDomain`.
   * @param homeDomain - The domain the toml was fetched from; also the value
   *   expected in the challenge's Manage Data key.
   * @throws {Sep10AuthError} if the toml omits `WEB_AUTH_ENDPOINT`,
   *   `SIGNING_KEY`, or `NETWORK_PASSPHRASE`.
   */
  static fromToml(
    toml: StellarToml,
    homeDomain: string,
    options: Partial<Omit<Sep10ClientOptions, "serverAccountId">> = {},
  ): Sep10Client {
    if (!toml.WEB_AUTH_ENDPOINT) {
      throw new Sep10AuthError(`${homeDomain} stellar.toml has no WEB_AUTH_ENDPOINT`);
    }
    if (!toml.SIGNING_KEY) {
      throw new Sep10AuthError(
        `${homeDomain} stellar.toml has no SIGNING_KEY - challenges from this anchor cannot be verified, refusing to authenticate`,
      );
    }
    const networkPassphrase = options.networkPassphrase ?? toml.NETWORK_PASSPHRASE;
    if (!networkPassphrase) {
      throw new Sep10AuthError(
        `${homeDomain} stellar.toml has no NETWORK_PASSPHRASE - pass networkPassphrase explicitly`,
      );
    }

    return new Sep10Client(toml.WEB_AUTH_ENDPOINT, {
      ...options,
      serverAccountId: toml.SIGNING_KEY,
      networkPassphrase,
      homeDomain: options.homeDomain ?? homeDomain,
      webAuthDomain: options.webAuthDomain ?? new URL(toml.WEB_AUTH_ENDPOINT).host,
    });
  }

  /**
   * Runs every SEP-10 check the client is responsible for before the challenge
   * is handed to a signer: the server's signature over the transaction, source
   * account, sequence number 0, the `<home_domain> auth` Manage Data operation
   * and its source, `web_auth_domain`, and time bounds.
   *
   * @throws {Sep10AuthError} if the challenge is not a well-formed challenge
   *   from the configured anchor on the configured network.
   */
  verifyChallenge(challenge: Sep10Challenge): void {
    // An anchor may echo the network it built the challenge for. If it does and
    // it disagrees with ours, stop here - otherwise readChallengeTx would be
    // checking the signature against the wrong network's transaction hash.
    if (
      challenge.network_passphrase !== undefined &&
      challenge.network_passphrase !== this.networkPassphrase
    ) {
      throw new Sep10AuthError(
        `challenge is for network "${challenge.network_passphrase}", expected "${this.networkPassphrase}"`,
      );
    }

    try {
      WebAuth.readChallengeTx(
        challenge.transaction,
        this.serverAccountId,
        this.networkPassphrase,
        this.homeDomain,
        this.webAuthDomain,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Sep10AuthError(`challenge failed validation (${reason})`);
    }
  }

  /** GET the challenge transaction the anchor wants signed. */
  async challenge(params: {
    account: string;
    memo?: string;
    clientDomain?: string;
  }): Promise<Sep10Challenge> {
    const url = new URL(this.webAuthEndpoint);
    url.searchParams.set("account", params.account);
    if (params.memo !== undefined) url.searchParams.set("memo", params.memo);
    if (params.clientDomain !== undefined) {
      url.searchParams.set("client_domain", params.clientDomain);
    }

    const response = await this.request(url.toString(), { method: "GET" });
    if (!response.ok) {
      throw new Sep10AuthError(`GET ${this.webAuthEndpoint} returned ${response.status}`);
    }

    const parsed = Sep10ChallengeSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Sep10AuthError("challenge response did not contain a transaction");
    }
    return parsed.data;
  }

  /** POST the signed challenge and return the session JWT. */
  async token(signedTransactionXdr: string): Promise<string> {
    const response = await this.request(this.webAuthEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: signedTransactionXdr }),
    });

    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `status ${response.status}`;
      throw new Sep10AuthError(`token exchange rejected: ${detail}`);
    }

    const parsed = Sep10TokenSchema.safeParse(body);
    if (!parsed.success) {
      throw new Sep10AuthError("token response did not contain a token");
    }
    return parsed.data.token;
  }

  /** Challenge → sign → token, the full handshake in one call. */
  async authenticate(params: Sep10AuthenticateParams): Promise<string> {
    const challenge = await this.challenge({
      account: params.account,
      ...(params.memo !== undefined ? { memo: params.memo } : {}),
      ...(params.clientDomain !== undefined ? { clientDomain: params.clientDomain } : {}),
    });

    // Validate BEFORE signing. `params.sign` may reach a hardware wallet or a
    // KMS, and whatever we hand it can be signed and broadcast - a hostile or
    // compromised anchor returning a payment or a set_options adding a signer
    // must be rejected here, not noticed afterwards.
    this.verifyChallenge(challenge);

    const signed = await params.sign(challenge);
    if (typeof signed !== "string" || signed === "") {
      throw new Sep10AuthError("signer returned an empty transaction");
    }

    return this.token(signed);
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.transport(url, { ...init, signal: controller.signal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Sep10AuthError(`request to ${url} failed (${reason})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
