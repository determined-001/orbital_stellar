import { describe, expect, it, vi } from "vitest";
import {
  Sep1DiscoveryError,
  Sep10AuthError,
  Sep10Client,
  type Sep10ClientOptions,
  Sep24Client,
  Sep24Error,
  discoverAnchor,
  parseStellarToml,
} from "../src/index.js";

const ANCHOR = "https://anchor.example.com/sep24";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A transport that rejects, standing in for DNS failure or a socket reset. */
function failingTransport(message: string) {
  return vi.fn(async () => {
    throw new Error(message);
  });
}

/**
 * Builds a Sep10Client for the transport-level cases below. These exercise
 * `challenge()` / `token()` directly and never sign, so the verification
 * parameters just need to be present and well-formed - `test/sep10.test.ts`
 * covers what they actually do.
 */
function sep10ClientWith(options: Partial<Sep10ClientOptions> = {}): Sep10Client {
  return new Sep10Client("https://a.example.com/auth", {
    serverAccountId: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    networkPassphrase: "Test SDF Network ; September 2015",
    homeDomain: "a.example.com",
    webAuthDomain: "a.example.com",
    ...options,
  });
}

describe("SEP-1 failure paths", () => {
  it("rejects an empty home domain before making a request", async () => {
    const transport = vi.fn();
    await expect(discoverAnchor("", { transport })).rejects.toBeInstanceOf(Sep1DiscoveryError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("strips a scheme and trailing slashes from the home domain", async () => {
    const calls: string[] = [];
    const transport = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(`WEB_AUTH_ENDPOINT = "https://a.example.com/auth"`, { status: 200 });
    });

    await discoverAnchor("https://anchor.example.com//", { transport });
    expect(calls[0]).toBe("https://anchor.example.com/.well-known/stellar.toml");
  });

  it("wraps a transport failure as a discovery error", async () => {
    await expect(
      discoverAnchor("anchor.example.com", { transport: failingTransport("EAI_AGAIN") }),
    ).rejects.toThrow(/could not reach/);
  });

  it("rejects an oversized toml on its declared content-length", async () => {
    const transport = vi.fn(
      async () =>
        new Response(`WEB_AUTH_ENDPOINT = "https://a.example.com/auth"`, {
          status: 200,
          headers: { "content-length": "5000000" },
        }),
    );

    await expect(
      discoverAnchor("anchor.example.com", { transport, maxBodyBytes: 1000 }),
    ).rejects.toThrow(/over the 1000-byte limit/);
  });

  it("stops reading a body that lies about its length", async () => {
    // content-length is a claim; an endless chunked body must still be cut off
    // rather than read until the consumer runs out of memory.
    let chunksServed = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksServed += 1;
        controller.enqueue(new TextEncoder().encode("A".repeat(1024)));
      },
    });
    const transport = vi.fn(async () => new Response(endless, { status: 200 }));

    await expect(
      discoverAnchor("anchor.example.com", { transport, maxBodyBytes: 4096 }),
    ).rejects.toThrow(/exceeded the 4096-byte limit/);

    // Bounded: it gave up rather than draining an infinite stream.
    expect(chunksServed).toBeLessThan(16);
  });

  // A `transport` override is free to return something Response-shaped that has
  // no readable `body` - undici polyfills and hand-rolled test doubles both do.
  // `readCapped` then falls back to `response.text()`, and the cap has to hold
  // on that path too, since the content-length check above is only a claim.
  function bodylessResponse(text: string): Response {
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => text,
    } as unknown as Response;
  }

  it("caps a bodyless response on the text() fallback path", async () => {
    const transport = vi.fn(async () => bodylessResponse("A".repeat(200)));

    await expect(
      discoverAnchor("anchor.example.com", { transport, maxBodyBytes: 100 }),
    ).rejects.toThrow(/exceeded the 100-byte limit/);
  });

  it("reads a bodyless response that fits under the cap", async () => {
    const transport = vi.fn(async () =>
      bodylessResponse(`WEB_AUTH_ENDPOINT = "https://a.example.com/auth"`),
    );

    const toml = await discoverAnchor("anchor.example.com", { transport, maxBodyBytes: 100 });
    expect(toml.WEB_AUTH_ENDPOINT).toBe("https://a.example.com/auth");
  });

  it("reads a normally sized toml unchanged", async () => {
    const transport = vi.fn(
      async () => new Response(`WEB_AUTH_ENDPOINT = "https://a.example.com/auth"`, { status: 200 }),
    );

    const toml = await discoverAnchor("anchor.example.com", { transport });
    expect(toml.WEB_AUTH_ENDPOINT).toBe("https://a.example.com/auth");
  });

  it("ignores unquoted, commented and non-string values", () => {
    const toml = parseStellarToml(
      [
        "WEB_AUTH_ENDPOINT = https://unquoted.example.com",
        `KYC_SERVER = "https://kyc.example.com" # trailing comment`,
        "NOT_A_KEY_WE_READ = 12",
        "malformed line without separator",
        `SIGNING_KEY = 'GABC'`,
      ].join("\n"),
    );

    expect(toml.WEB_AUTH_ENDPOINT).toBeUndefined();
    expect(toml.KYC_SERVER).toBe("https://kyc.example.com");
    expect(toml.SIGNING_KEY).toBe("GABC");
  });
});

describe("SEP-10 failure paths", () => {
  it("reports a non-2xx challenge response", async () => {
    const transport = vi.fn(async () => new Response("no", { status: 400 }));
    const client = sep10ClientWith({ transport });

    await expect(client.challenge({ account: "GABC" })).rejects.toThrow(/returned 400/);
  });

  it("rejects a challenge body with no transaction", async () => {
    const transport = vi.fn(async () => jsonResponse({ nope: true }));
    const client = sep10ClientWith({ transport });

    await expect(client.challenge({ account: "GABC" })).rejects.toBeInstanceOf(Sep10AuthError);
  });

  it("surfaces the anchor's error message when the token exchange is rejected", async () => {
    const transport = vi.fn(async () => jsonResponse({ error: "invalid signature" }, 401));
    const client = sep10ClientWith({ transport });

    await expect(client.token("signed")).rejects.toThrow(/invalid signature/);
  });

  it("rejects a token response with no token", async () => {
    const transport = vi.fn(async () => jsonResponse({ jwt: "wrong-field" }));
    const client = sep10ClientWith({ transport });

    await expect(client.token("signed")).rejects.toThrow(/did not contain a token/);
  });

  it("passes memo and client_domain through to the challenge request", async () => {
    const calls: string[] = [];
    const transport = vi.fn(async (url: string) => {
      calls.push(url);
      return jsonResponse({ transaction: "AAAA" });
    });
    const client = sep10ClientWith({ transport });

    await client.challenge({ account: "GABC", memo: "12345", clientDomain: "app.example.com" });

    expect(calls[0]).toContain("memo=12345");
    expect(calls[0]).toContain("client_domain=app.example.com");
  });

  it("wraps a transport failure", async () => {
    const client = sep10ClientWith({ transport: failingTransport("ECONNRESET") });

    await expect(client.challenge({ account: "GABC" })).rejects.toThrow(/request to .* failed/);
  });
});

describe("SEP-24 failure paths", () => {
  it("reports a non-2xx /info", async () => {
    const transport = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(new Sep24Client(ANCHOR, { transport }).info()).rejects.toThrow(
      /GET \/info returned 503/,
    );
  });

  it("rejects an /info body that does not match the schema", async () => {
    const transport = vi.fn(async () => jsonResponse({ deposit: "not-an-object" }));
    await expect(new Sep24Client(ANCHOR, { transport }).info()).rejects.toBeInstanceOf(Sep24Error);
  });

  it("reports a plain initiation failure with the anchor's error text", async () => {
    const transport = vi.fn(async () => jsonResponse({ error: "asset not supported" }, 400));
    await expect(
      new Sep24Client(ANCHOR, { transport }).initiateDeposit({ asset_code: "FOO" }, "jwt"),
    ).rejects.toThrow(/asset not supported/);
  });

  it("handles a customer-info error whose fields arrive as an object", async () => {
    const transport = vi.fn(async () =>
      jsonResponse(
        { type: "customer_info_status", fields: { email_address: { description: "email" } } },
        403,
      ),
    );

    await expect(
      new Sep24Client(ANCHOR, { transport }).initiateDeposit({ asset_code: "USDC" }, "jwt"),
    ).rejects.toMatchObject({ fields: ["email_address"] });
  });

  it("merges SEP-9 fields into the initiation body", async () => {
    let body: unknown;
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse({ type: "interactive_customer_info_needed", url: "u", id: "tx" });
    });

    await new Sep24Client(ANCHOR, { transport }).initiateDeposit(
      { asset_code: "USDC", fields: { email_address: "a@b.c" } },
      "jwt",
    );

    expect(body).toEqual({ asset_code: "USDC", email_address: "a@b.c" });
  });

  it("reports a non-2xx transaction poll", async () => {
    const transport = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(new Sep24Client(ANCHOR, { transport }).transaction("tx-1", "jwt")).rejects.toThrow(
      /GET \/transaction returned 404/,
    );
  });

  it("wraps a transport failure on poll", async () => {
    const client = new Sep24Client(ANCHOR, { transport: failingTransport("socket hang up") });
    await expect(client.transaction("tx-1", "jwt")).rejects.toThrow(/request to .* failed/);
  });
});

describe("request timeouts", () => {
  /** A transport that only settles when its abort signal fires. */
  function stallingTransport() {
    return vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
  }

  it("aborts a stalled SEP-1 discovery once timeoutMs elapses", async () => {
    const pending = discoverAnchor("anchor.example.com", {
      transport: stallingTransport(),
      timeoutMs: 5,
    });
    await expect(pending).rejects.toThrow(/could not reach/);
  });

  it("aborts a stalled SEP-10 challenge", async () => {
    const client = sep10ClientWith({ transport: stallingTransport(), timeoutMs: 5 });
    await expect(client.challenge({ account: "GABC" })).rejects.toThrow(/request to .* failed/);
  });

  it("aborts a stalled SEP-24 poll", async () => {
    const client = new Sep24Client(ANCHOR, { transport: stallingTransport(), timeoutMs: 5 });
    await expect(client.transaction("tx-1", "jwt")).rejects.toThrow(/request to .* failed/);
  });
});
