import { z } from "zod";

/**
 * SEP-10 authentication: fetch a challenge transaction, sign it, exchange it
 * for a JWT.
 *
 * Signing is delegated to a caller-supplied callback rather than taking a
 * secret key. This package never holds key material: a consumer can sign with
 * a hardware wallet, a KMS, or `Keypair.sign` - the SDK only sees the signed
 * XDR that comes back.
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
  private readonly transport: (input: string, init?: RequestInit) => Promise<Response>;
  private readonly timeoutMs: number;

  constructor(webAuthEndpoint: string, options: Sep10ClientOptions = {}) {
    this.webAuthEndpoint = webAuthEndpoint.replace(/\/+$/, "");
    this.transport = options.transport ?? fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 10_000;
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
