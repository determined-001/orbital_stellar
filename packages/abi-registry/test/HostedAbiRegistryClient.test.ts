import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostedAbiRegistryClient } from "../src/HostedAbiRegistryClient.js";
import type { AbiRegistryReader } from "../src/ChainedAbiRegistryClient.js";
import type { XdrContractSpec } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const BASE_URL = "https://abi.orbital.dev";

function makeSpec(contractId = CONTRACT_ID, entries = ["AAAAAA=="]): XdrContractSpec {
  return { contractId, entries };
}

function specHash(spec: XdrContractSpec): string {
  const entries = [...(spec.entries ?? [])].sort();
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

/** Returns a minimal Response-like object for a successful JSON payload. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Returns a Response-like object with no JSON body for error status codes. */
function errorResponse(status: number): Response {
  return new Response("", { status });
}

/**
 * Builds a transport mock and a `HostedAbiRegistryClient` wired to it.
 * `sampleRate: 0` disables sampled hash verification by default so the
 * tests that don't care about sampling can focus on other behaviours.
 */
function makeClient(
  transportImpl: (url: string, init?: RequestInit) => Promise<Response>,
  overrides: Partial<ConstructorParameters<typeof HostedAbiRegistryClient>[0]> = {},
) {
  const transport = vi.fn(transportImpl);
  const client = new HostedAbiRegistryClient({
    baseUrl: BASE_URL,
    sampleRate: 0, // off by default unless a test overrides it
    transport: transport as unknown as (
      input: RequestInfo,
      init?: RequestInit,
    ) => Promise<Response>,
    ...overrides,
  });
  return { client, transport };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("HostedAbiRegistryClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Successful hosted hit ─────────────────────────────────────────────────

  describe("hosted hit", () => {
    it("returns the spec from the hosted /v1/ endpoint on a 200 response", async () => {
      const spec = makeSpec();
      const { client } = makeClient(async () => jsonResponse(spec));

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toEqual(spec);
    });

    it("requests the correct URL for getSpec", async () => {
      const spec = makeSpec();
      const { client, transport } = makeClient(async () => jsonResponse(spec));

      await client.getSpec(CONTRACT_ID);

      expect(transport).toHaveBeenCalledOnce();
      const [url] = transport.mock.calls[0] as [string];
      expect(url).toBe(`${BASE_URL}/v1/specs/${CONTRACT_ID}`);
    });

    it("requests the correct URL for getSpecAt", async () => {
      const spec = makeSpec();
      const { client, transport } = makeClient(async () => jsonResponse(spec));

      await client.getSpecAt(CONTRACT_ID, 500);

      expect(transport).toHaveBeenCalledOnce();
      const [url] = transport.mock.calls[0] as [string];
      expect(url).toBe(`${BASE_URL}/v1/specs/${CONTRACT_ID}?ledger=500`);
    });

    it("caches a successful getSpec result - second call skips the network", async () => {
      const spec = makeSpec();
      const { client, transport } = makeClient(async () => jsonResponse(spec));

      await client.getSpec(CONTRACT_ID);
      const second = await client.getSpec(CONTRACT_ID);

      expect(transport).toHaveBeenCalledOnce();
      expect(second).toEqual(spec);
    });

    it("caches getSpecAt separately from getSpec (different cache keys)", async () => {
      const specLatest = makeSpec(CONTRACT_ID, ["latest=="]);
      const specAt = makeSpec(CONTRACT_ID, ["at500=="]);

      const { client, transport } = makeClient(async (url: string) => {
        if (url.includes("ledger=")) return jsonResponse(specAt);
        return jsonResponse(specLatest);
      });

      const latest = await client.getSpec(CONTRACT_ID);
      const atLedger = await client.getSpecAt(CONTRACT_ID, 500);

      expect(latest).toEqual(specLatest);
      expect(atLedger).toEqual(specAt);
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it("returns null on 404 (fall through to next chain link)", async () => {
      const { client } = makeClient(async () => errorResponse(404));

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toBeNull();
    });
  });

  // ── Timeout fallback ──────────────────────────────────────────────────────

  describe("timeout fallback", () => {
    it("returns null when the request exceeds timeoutMs (AbortError)", async () => {
      const { client } = makeClient(
        async (_url, init) => {
          // Simulate the AbortController firing.
          const signal = (init as RequestInit & { signal?: AbortSignal }).signal;
          if (signal) {
            await new Promise<never>((_resolve, reject) => {
              signal.addEventListener("abort", () => {
                const err = new DOMException("The operation was aborted.", "AbortError");
                reject(err);
              });
            });
          }
          // Unreachable, but keeps TS happy.
          throw new Error("should not reach here");
        },
        { timeoutMs: 10 },
      );

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toBeNull();
    });

    it("does not log an error on timeout - silent fall-through", async () => {
      const { client } = makeClient(
        async () => {
          const err = new DOMException("The operation was aborted.", "AbortError");
          throw err;
        },
        { timeoutMs: 10 },
      );

      await client.getSpec(CONTRACT_ID);

      expect(console.error).not.toHaveBeenCalled();
    });
  });

  // ── 5xx fallback ──────────────────────────────────────────────────────────

  describe("5xx fallback", () => {
    it.each([500, 502, 503, 504])(
      "returns null on %d (hosted service degraded)",
      async (status) => {
        const { client } = makeClient(async () => errorResponse(status));

        const result = await client.getSpec(CONTRACT_ID);

        expect(result).toBeNull();
      },
    );

    it("does not log an error on 5xx - silent fall-through", async () => {
      const { client } = makeClient(async () => errorResponse(503));

      await client.getSpec(CONTRACT_ID);

      expect(console.error).not.toHaveBeenCalled();
    });
  });

  // ── Hash-mismatch fallback with error log ─────────────────────────────────

  describe("hash-mismatch fallback", () => {
    /**
     * Constructs a client with `sampleRate: 1` (every request sampled) and
     * an on-chain client stub that returns `chainSpec`.
     */
    function makeClientWithSampling(
      hostedSpec: XdrContractSpec,
      chainSpec: XdrContractSpec | null,
    ) {
      const onChainClient: AbiRegistryReader = {
        getSpec: vi.fn().mockResolvedValue(chainSpec),
      };

      const { client, transport } = makeClient(async () => jsonResponse(hostedSpec), {
        sampleRate: 1, // always sample
        onChainClient,
      });

      return { client, transport, onChainClient };
    }

    it("returns the spec when hashes match (no error logged)", async () => {
      const spec = makeSpec();
      // Both hosted and chain return the same spec → same hash.
      const { client } = makeClientWithSampling(spec, spec);

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toEqual(spec);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("returns null and logs an error when hashes differ", async () => {
      const hostedSpec = makeSpec(CONTRACT_ID, ["AAAAAA=="]);
      const chainSpec = makeSpec(CONTRACT_ID, ["BBBBBB=="]);

      expect(specHash(hostedSpec)).not.toBe(specHash(chainSpec));

      const { client } = makeClientWithSampling(hostedSpec, chainSpec);

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toBeNull();
    });

    it("logs a hard error message mentioning the contractId on hash mismatch", async () => {
      const hostedSpec = makeSpec(CONTRACT_ID, ["AAAAAA=="]);
      const chainSpec = makeSpec(CONTRACT_ID, ["BBBBBB=="]);

      const { client } = makeClientWithSampling(hostedSpec, chainSpec);

      await client.getSpec(CONTRACT_ID);

      expect(console.error).toHaveBeenCalledOnce();
      const [errorMessage] = (console.error as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(errorMessage).toContain(CONTRACT_ID);
      expect(errorMessage).toContain("hash mismatch");
    });

    it("falls through gracefully when the on-chain client itself throws during sampling", async () => {
      const hostedSpec = makeSpec();
      const onChainClient: AbiRegistryReader = {
        getSpec: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
      };

      const { client } = makeClient(async () => jsonResponse(hostedSpec), {
        sampleRate: 1,
        onChainClient,
      });

      // On-chain error during sampling should not propagate - spec returned.
      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toEqual(hostedSpec);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("skips verification when on-chain client returns null (contract not on chain yet)", async () => {
      const hostedSpec = makeSpec();
      const { client } = makeClientWithSampling(hostedSpec, null);

      const result = await client.getSpec(CONTRACT_ID);

      // Not on chain yet is not a mismatch - return the hosted spec.
      expect(result).toEqual(hostedSpec);
      expect(console.error).not.toHaveBeenCalled();
    });

    it("skips verification when no onChainClient is configured", async () => {
      const spec = makeSpec();
      const { client } = makeClient(async () => jsonResponse(spec), {
        sampleRate: 1,
        // onChainClient intentionally omitted
      });

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toEqual(spec);
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  // ── URL construction ──────────────────────────────────────────────────────

  describe("URL construction", () => {
    it("strips a trailing slash from the base URL", async () => {
      const spec = makeSpec();
      const transport = vi.fn(async () => jsonResponse(spec));
      const client = new HostedAbiRegistryClient({
        baseUrl: `${BASE_URL}/`,
        sampleRate: 0,
        transport: transport as unknown as (
          input: RequestInfo,
          init?: RequestInit,
        ) => Promise<Response>,
      });

      await client.getSpec(CONTRACT_ID);

      const [url] = transport.mock.calls[0] as [string];
      // The protocol's own "//" must not count - only a doubled slash in the
      // path would indicate the trailing slash survived.
      expect(new URL(url).pathname).not.toMatch(/\/\//);
      expect(url.startsWith(`${BASE_URL}/v1/`)).toBe(true);
    });

    it("URL-encodes the contractId in the path", async () => {
      const spec = makeSpec();
      const { client, transport } = makeClient(async () => jsonResponse(spec));
      const contractWithSpecialChars = "C%SPECIAL/ID";

      await client.getSpec(contractWithSpecialChars);

      const [url] = transport.mock.calls[0] as [string];
      expect(url).toContain(encodeURIComponent(contractWithSpecialChars));
      expect(url).not.toContain("%SPECIAL/ID");
    });
  });

  // ── Network / parse error fallback ───────────────────────────────────────

  describe("network and parse error fallback", () => {
    it("returns null on a generic network error (e.g. DNS failure)", async () => {
      const { client } = makeClient(async () => {
        throw new TypeError("Failed to fetch");
      });

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toBeNull();
    });

    it("returns null when the response body is not valid JSON", async () => {
      const { client } = makeClient(async () => new Response("not json at all", { status: 200 }));

      const result = await client.getSpec(CONTRACT_ID);

      expect(result).toBeNull();
    });
  });
});
