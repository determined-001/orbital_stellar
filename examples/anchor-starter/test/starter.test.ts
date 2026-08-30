import { describe, it, expect, vi, afterEach } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import { WebAuth } from "@orbital-stellar/pulse-core";
import { loadConfig, MissingConfigError } from "../src/config.js";
import { connect } from "../src/anchor.js";
import { deposit, send, UnsupportedByAnchorError } from "../src/commands.js";

const HOME_DOMAIN = "anchor.example";
const serverKeypair = Keypair.random();
const clientKeypair = Keypair.random();

const TOML = `
WEB_AUTH_ENDPOINT = "https://${HOME_DOMAIN}/auth"
TRANSFER_SERVER_SEP0024 = "https://${HOME_DOMAIN}/sep24"
DIRECT_PAYMENT_SERVER = "https://${HOME_DOMAIN}/sep31"
SIGNING_KEY = "${serverKeypair.publicKey()}"
NETWORK_PASSPHRASE = "${Networks.TESTNET}"
`;

function buildChallenge(): string {
  return WebAuth.buildChallengeTx(
    serverKeypair,
    clientKeypair.publicKey(),
    HOME_DOMAIN,
    300,
    Networks.TESTNET,
    HOME_DOMAIN,
  );
}

/** Routes a mocked fetch by URL suffix, matching real endpoint shapes. */
function mockFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    for (const [suffix, handler] of Object.entries(handlers)) {
      if (url.includes(suffix)) return handler(init);
    }
    throw new Error(`unhandled fetch: ${url}`);
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadConfig", () => {
  it("refuses to boot without a well-formed STELLAR_SECRET", () => {
    expect(() => loadConfig({})).toThrow(MissingConfigError);
    expect(() => loadConfig({ STELLAR_SECRET: "not-a-secret" })).toThrow(MissingConfigError);
  });

  it("applies documented defaults", () => {
    const config = loadConfig({ STELLAR_SECRET: Keypair.random().secret() });
    expect(config.homeDomain).toBe("testanchor.stellar.org");
    expect(config.network).toBe("testnet");
    expect(config.assetCode).toBe("SRT");
  });
});

describe("connect", () => {
  it("runs SEP-1 discovery then SEP-10 authentication, returning a usable session", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/.well-known/stellar.toml": () => new Response(TOML, { status: 200 }),
        "/auth": (init) => {
          if (init?.method === "POST") {
            return new Response(JSON.stringify({ token: "jwt.token.here" }), { status: 200 });
          }
          return new Response(
            JSON.stringify({ transaction: buildChallenge(), network_passphrase: Networks.TESTNET }),
            { status: 200 },
          );
        },
      }),
    );

    const config = loadConfig({ STELLAR_SECRET: clientKeypair.secret(), HOME_DOMAIN });
    const session = await connect(config);

    expect(session.publicKey).toBe(clientKeypair.publicKey());
    expect(session.token).toBe("jwt.token.here");
    expect(session.sep24).toBeDefined();
    expect(session.sep31).toBeDefined();
  });
});

describe("deposit", () => {
  it("starts an interactive deposit, prints the URL, and polls to completed", async () => {
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/transactions/deposit/interactive": () =>
          new Response(
            JSON.stringify({ type: "interactive_customer_info_needed", url: "https://x/kyc", id: "tx1" }),
            { status: 200 },
          ),
        "/transaction?": () => {
          polls += 1;
          const status = polls === 1 ? "pending_user_transfer_start" : "completed";
          return new Response(JSON.stringify({ transaction: { id: "tx1", kind: "deposit", status } }), {
            status: 200,
          });
        },
      }),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const session = {
      toml: {},
      publicKey: clientKeypair.publicKey(),
      token: "jwt",
      sep24: new (await import("@orbital-stellar/anchor-sdk")).Sep24Client("https://anchor.example/sep24"),
    };
    const config = loadConfig({ STELLAR_SECRET: clientKeypair.secret() });
    const lines: string[] = [];

    const run = deposit(session as any, config, undefined, (m) => lines.push(m));
    await vi.advanceTimersByTimeAsync(5_000);
    await run;

    vi.useRealTimers();

    expect(lines.some((l) => l.includes("https://x/kyc"))).toBe(true);
    expect(lines.some((l) => l.includes("completed"))).toBe(true);
  });

  it("throws UnsupportedByAnchorError when the anchor has no SEP-24 endpoint", async () => {
    const session = { toml: {}, publicKey: "G", token: "jwt", sep24: undefined };
    const config = loadConfig({ STELLAR_SECRET: clientKeypair.secret() });
    await expect(deposit(session as any, config, undefined, () => {})).rejects.toThrow(
      UnsupportedByAnchorError,
    );
  });
});

describe("send", () => {
  it("reports missing SEP-12 registration instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/sep31/info": () =>
          new Response(JSON.stringify({ receive: { SRT: {} } }), { status: 200 }),
        "/sep31/transactions": () =>
          new Response(JSON.stringify({ error: "customer_info_needed", type: "receiver", fields: ["email"] }), {
            status: 400,
          }),
      }),
    );

    const session = {
      toml: {},
      publicKey: clientKeypair.publicKey(),
      token: "jwt",
      sep31: new (await import("@orbital-stellar/anchor-sdk")).Sep31Client("https://anchor.example/sep31"),
    };
    const config = loadConfig({ STELLAR_SECRET: clientKeypair.secret() });
    const lines: string[] = [];

    await send(session as any, config, "10", (m) => lines.push(m));

    expect(lines.some((l) => l.includes("receiver info needed") || l.includes("email"))).toBe(true);
  });

  it("reports an asset the anchor doesn't accept via SEP-31, without calling initiateTransaction", async () => {
    const initiate = vi.fn();
    vi.stubGlobal(
      "fetch",
      mockFetch({
        "/sep31/info": () => new Response(JSON.stringify({ receive: {} }), { status: 200 }),
        "/sep31/transactions": () => {
          initiate();
          return new Response(JSON.stringify({ error: "should not be called" }), { status: 400 });
        },
      }),
    );

    const session = {
      toml: {},
      publicKey: clientKeypair.publicKey(),
      token: "jwt",
      sep31: new (await import("@orbital-stellar/anchor-sdk")).Sep31Client("https://anchor.example/sep31"),
    };
    const config = loadConfig({ STELLAR_SECRET: clientKeypair.secret() });
    const lines: string[] = [];

    await send(session as any, config, "10", (m) => lines.push(m));

    expect(initiate).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("does not currently accept"))).toBe(true);
  });
});
