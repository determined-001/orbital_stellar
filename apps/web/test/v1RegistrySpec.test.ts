import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getCachedResolvedSpec, getCachedLedgerSequence } = vi.hoisted(() => ({
  getCachedResolvedSpec: vi.fn(),
  getCachedLedgerSequence: vi.fn(),
}));

vi.mock("@/lib/hostedRegistryApi", () => ({
  getCachedResolvedSpec,
  getCachedLedgerSequence,
  specHashOf: vi.fn(() => "deadbeef"),
}));

import { GET } from "@/app/api/v1/registry/spec/[contractId]/route";

const CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

function call(contractId: string, query = "") {
  return GET(
    new NextRequest(`https://orbital.example/api/v1/registry/spec/${contractId}${query}`),
    { params: Promise.resolve({ contractId }) },
  );
}

beforeEach(() => {
  getCachedResolvedSpec.mockReset();
  getCachedLedgerSequence.mockReset();
  getCachedLedgerSequence.mockResolvedValue({ value: 12345, stale: false });
});

describe("GET /api/v1/registry/spec/[contractId]", () => {
  it("rejects a malformed contractId", async () => {
    const res = await call("not-a-contract-id");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_contract_id");
  });

  it("returns 501 for ?version= (not yet supported)", async () => {
    const res = await call(CONTRACT_ID, "?version=1.0.0");
    expect(res.status).toBe(501);
    expect(getCachedResolvedSpec).not.toHaveBeenCalled();
  });

  it("resolves the spec and wraps it in the hosted API envelope", async () => {
    getCachedResolvedSpec.mockResolvedValue({
      value: { spec: { name: "USDC" }, specSource: "wellKnown" },
      stale: false,
    });

    const res = await call(CONTRACT_ID);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { spec: { name: string }; specHash: string };
      servedFrom: string;
      asOfLedger: number;
      stale: boolean;
    };
    expect(body.data.spec).toEqual({ name: "USDC" });
    expect(body.data.specHash).toBe("deadbeef");
    expect(body.servedFrom).toBe("wellKnown");
    expect(body.asOfLedger).toBe(12345);
    expect(body.stale).toBe(false);
  });

  it("surfaces staleness explicitly rather than silently", async () => {
    getCachedResolvedSpec.mockResolvedValue({
      value: { spec: { name: "USDC" }, specSource: "registry" },
      stale: true,
    });

    const res = await call(CONTRACT_ID);
    const body = (await res.json()) as { stale: boolean };
    expect(body.stale).toBe(true);
  });

  it("returns 404 when nothing resolves", async () => {
    getCachedResolvedSpec.mockResolvedValue({ value: null, stale: false });
    const res = await call(CONTRACT_ID);
    expect(res.status).toBe(404);
  });

  it("returns 500 with the underlying error message when resolution throws", async () => {
    getCachedResolvedSpec.mockRejectedValue(new Error("RPC unreachable"));
    const res = await call(CONTRACT_ID);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("RPC unreachable");
  });
});
