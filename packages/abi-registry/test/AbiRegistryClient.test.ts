import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AbiRegistryClient } from "../src/AbiRegistryClient.js";
import type { ContractSpec } from "../src/types.js";

function makeSpec(contractId: string): ContractSpec {
  return { contractId, entries: ["base64entry=="] };
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))),
  );
}

describe("AbiRegistryClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getSpecs", () => {
    it("issues a single POST /specs for 100 unique contract IDs", async () => {
      const ids = Array.from({ length: 100 }, (_, i) => `CONTRACT_${i}`);
      const responseBody: Record<string, ContractSpec> = Object.fromEntries(
        ids.map((id) => [id, makeSpec(id)]),
      );

      mockFetch(
        () =>
          new Response(JSON.stringify(responseBody), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });
      const result = await client.getSpecs(ids);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        "https://abi.example.com/specs",
        expect.objectContaining({ method: "POST" }),
      );
      expect(result["CONTRACT_0"]).toEqual(makeSpec("CONTRACT_0"));
      expect(result["CONTRACT_99"]).toEqual(makeSpec("CONTRACT_99"));
    });

    it("returns null for contract IDs not found in the registry", async () => {
      mockFetch(() => new Response(JSON.stringify({ CONTRACT_A: null }), { status: 200 }));

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });
      const result = await client.getSpecs(["CONTRACT_A"]);

      expect(result["CONTRACT_A"]).toBeNull();
    });

    it("serves cached results without a network call", async () => {
      const spec = makeSpec("CONTRACT_X");
      mockFetch(() => new Response(JSON.stringify({ CONTRACT_X: spec }), { status: 200 }));

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });

      await client.getSpecs(["CONTRACT_X"]);
      const result = await client.getSpecs(["CONTRACT_X"]);

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result["CONTRACT_X"]).toEqual(spec);
    });

    it("only fetches uncached IDs on a second call", async () => {
      const specA = makeSpec("CONTRACT_A");
      const specB = makeSpec("CONTRACT_B");

      const fetchMock = vi.fn();
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ CONTRACT_A: specA }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ CONTRACT_B: specB }), { status: 200 }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });

      await client.getSpecs(["CONTRACT_A"]);
      const result = await client.getSpecs(["CONTRACT_A", "CONTRACT_B"]);

      expect(fetch).toHaveBeenCalledTimes(2);
      // Second call should only request CONTRACT_B
      const secondCallBody = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
      ) as { contractIds: string[] };
      expect(secondCallBody.contractIds).toEqual(["CONTRACT_B"]);

      expect(result["CONTRACT_A"]).toEqual(specA);
      expect(result["CONTRACT_B"]).toEqual(specB);
    });

    it("caches null results so missing IDs are not re-fetched", async () => {
      mockFetch(() => new Response(JSON.stringify({ CONTRACT_MISSING: null }), { status: 200 }));

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });

      await client.getSpecs(["CONTRACT_MISSING"]);
      await client.getSpecs(["CONTRACT_MISSING"]);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("throws when the registry returns a non-OK status", async () => {
      mockFetch(() => new Response("Internal Server Error", { status: 500 }));

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });

      await expect(client.getSpecs(["CONTRACT_A"])).rejects.toThrow(
        "ABI registry responded with 500",
      );
    });

    it("strips a trailing slash from baseUrl", async () => {
      mockFetch(() => new Response(JSON.stringify({ C: makeSpec("C") }), { status: 200 }));

      const client = new AbiRegistryClient({
        baseUrl: "https://abi.example.com/",
      });
      await client.getSpecs(["C"]);

      expect(fetch).toHaveBeenCalledWith("https://abi.example.com/specs", expect.anything());
    });
  });

  describe("getSpec", () => {
    it("delegates to getSpecs and returns the single result", async () => {
      const spec = makeSpec("CONTRACT_Z");
      mockFetch(() => new Response(JSON.stringify({ CONTRACT_Z: spec }), { status: 200 }));

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });
      const result = await client.getSpec("CONTRACT_Z");

      expect(result).toEqual(spec);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("returns null when the contract is not found", async () => {
      mockFetch(() => new Response(JSON.stringify({ CONTRACT_Z: null }), { status: 200 }));

      const client = new AbiRegistryClient({ baseUrl: "https://abi.example.com" });
      expect(await client.getSpec("CONTRACT_Z")).toBeNull();
    });
  });

  describe("LRU eviction", () => {
    it("evicts the least-recently-used entry when maxCacheSize is exceeded", async () => {
      // Cache size of 2: fill with A and B, then access A, then add C.
      // B should be evicted (LRU), so fetching B again requires a network call.
      const fetchMock = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
        );
      vi.stubGlobal("fetch", fetchMock);

      const client = new AbiRegistryClient({
        baseUrl: "https://abi.example.com",
        maxCacheSize: 2,
      });

      // Populate cache with A and B (2 calls).
      await client.getSpecs(["A"]);
      await client.getSpecs(["B"]);
      // Refresh A so B becomes LRU.
      await client.getSpecs(["A"]);
      // Add C — evicts B.
      await client.getSpecs(["C"]);
      // Fetch B again — must hit the network.
      await client.getSpecs(["B"]);

      // Calls: A, B, (A cached), C, B (evicted)
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });
});
