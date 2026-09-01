import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// `vi.hoisted` so these exist before `vi.mock`'s factory runs - the route
// now constructs its default-chain client at module load, so importing it
// below resolves the (mocked) module immediately, ahead of any plain
// top-level `const` in this file.
const { getResolvedSpec, getSpec, getSpecByVersion } = vi.hoisted(() => ({
  getResolvedSpec: vi.fn(),
  getSpec: vi.fn(),
  getSpecByVersion: vi.fn(),
}));

vi.mock("@orbital-stellar/abi-registry", () => ({
  createDefaultAbiRegistryClient: vi.fn(() => ({ getResolvedSpec })),
  OnChainAbiRegistryClient: vi.fn().mockImplementation(function (this: unknown) {
    return { getSpec, getSpecByVersion };
  }),
  ORBITAL_REGISTRY_TESTNET_CONTRACT_ID: "",
  ORBITAL_REGISTRY_PUBLISHER_ADDRESS: "",
  ORBITAL_REGISTRY_TESTNET_RPC_URL: "https://soroban-testnet.stellar.org",
}));

import { GET } from "@/app/api/registry-data/spec/[contractId]/route";

const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
const PUBLISHER = "GASDKEGVDZFF423H4MX27UHZUX35PBQBJBZTGCS7IVNVKG2LQTVVO7R7";

function req(url: string, ip: string): NextRequest {
  return new NextRequest(url, { headers: { "x-vercel-forwarded-for": ip } });
}

let counter = 0;
const freshIp = () => `198.51.100.${++counter % 250}${Math.floor(counter / 250)}`;

function call(contractId: string, query: string, ip = freshIp()) {
  return GET(req(`https://orbital.example/api/registry-data/spec/${contractId}${query}`, ip), {
    params: Promise.resolve({ contractId }),
  });
}

beforeEach(() => {
  getResolvedSpec.mockReset();
  getSpec.mockReset();
  getSpecByVersion.mockReset();
  delete process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID;
  delete process.env.ORBITAL_REGISTRY_PUBLISHER_ADDRESS;
});

afterEach(() => {
  delete process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID;
  delete process.env.ORBITAL_REGISTRY_PUBLISHER_ADDRESS;
});

describe("GET /api/registry-data/spec/[contractId]", () => {
  it("rejects a malformed contractId", async () => {
    const res = await call("not-a-contract-id", "");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_contract_id");
  });

  it("resolves the latest spec via the default chain when no query params are given", async () => {
    getResolvedSpec.mockResolvedValue({ spec: { name: "USDC" }, specSource: "wellKnown" });

    const res = await call(CONTRACT_ID, "");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60, stale-while-revalidate=3600");
    const body = (await res.json()) as { specSource: string };
    expect(body.specSource).toBe("wellKnown");
    expect(getResolvedSpec).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it("returns 404 when the default chain resolves nothing", async () => {
    getResolvedSpec.mockResolvedValue(null);
    const res = await call(CONTRACT_ID, "");
    expect(res.status).toBe(404);
  });

  it("returns 503 for ?version= when the on-chain registry isn't deployed", async () => {
    const res = await call(CONTRACT_ID, "?version=1.0.0");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("registry_not_deployed");
    expect(getSpecByVersion).not.toHaveBeenCalled();
  });

  it("returns 503 for ?publisher= when the on-chain registry isn't deployed", async () => {
    const res = await call(CONTRACT_ID, `?publisher=${PUBLISHER}`);
    expect(res.status).toBe(503);
    expect(getSpec).not.toHaveBeenCalled();
  });

  it("queries the on-chain registry for ?version= once the registry contract id is configured", async () => {
    process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID = "CREGISTRYIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    process.env.ORBITAL_REGISTRY_PUBLISHER_ADDRESS = PUBLISHER;
    getSpecByVersion.mockResolvedValue({ name: "USDC", version: "1.0.0" });

    const res = await call(CONTRACT_ID, "?version=1.0.0");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { specSource: string; version: string; publisher: string };
    expect(body.specSource).toBe("registry");
    expect(body.version).toBe("1.0.0");
    expect(body.publisher).toBe(PUBLISHER);
    expect(getSpecByVersion).toHaveBeenCalledWith(CONTRACT_ID, "1.0.0");
  });

  it("requires ?publisher= (or a configured default) once the registry is deployed", async () => {
    process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID = "CREGISTRYIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

    const res = await call(CONTRACT_ID, "?version=1.0.0");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("publisher_required");
  });

  it("returns 404 when the requested version was never published", async () => {
    process.env.ORBITAL_REGISTRY_TESTNET_CONTRACT_ID = "CREGISTRYIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
    getSpecByVersion.mockResolvedValue(null);

    const res = await call(CONTRACT_ID, `?version=9.9.9&publisher=${PUBLISHER}`);
    expect(res.status).toBe(404);
  });

  it("returns 500 with the underlying error message when resolution throws", async () => {
    getResolvedSpec.mockRejectedValue(new Error("RPC unreachable"));
    const res = await call(CONTRACT_ID, "");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("RPC unreachable");
  });

  it("is rate limited per IP", async () => {
    getResolvedSpec.mockResolvedValue({ spec: { name: "USDC" }, specSource: "wellKnown" });
    const ip = freshIp();

    const first = await call(CONTRACT_ID, "", ip);
    expect(first.status).toBe(200);

    const second = await call(CONTRACT_ID, "", ip);
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeTruthy();
  });
});
