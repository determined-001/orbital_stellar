import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { getCachedTaxonomy, getCachedLabels, getCachedLedgerSequence } = vi.hoisted(() => ({
  getCachedTaxonomy: vi.fn(),
  getCachedLabels: vi.fn(),
  getCachedLedgerSequence: vi.fn(),
}));

vi.mock("@/lib/hostedRegistryApi", () => ({
  getCachedTaxonomy,
  getCachedLabels,
  getCachedLedgerSequence,
}));

import { GET as taxonomyGET } from "@/app/api/v1/registry/taxonomy/route";
import { GET as labelsGET } from "@/app/api/v1/registry/labels/route";

const TAXONOMY = [
  { id: "t1", name: "transfer", type: "event", category: "payments", eventType: "x", description: "d", source: "s" },
  { id: "t2", name: "swap", type: "event", category: "amm", eventType: "y", description: "d", source: "s" },
];

const LABELS = [
  { contractId: "C1", name: "USDC", description: "d", network: "mainnet", tags: ["stablecoin"], category: "token", verified: true, specFile: "usdc.json" },
  { contractId: "C2", name: "AQUA", description: "d", network: "testnet", tags: ["governance", "amm"], category: "token", verified: false, specFile: "aqua.json" },
];

beforeEach(() => {
  getCachedTaxonomy.mockReset();
  getCachedLabels.mockReset();
  getCachedLedgerSequence.mockReset();
  getCachedLedgerSequence.mockResolvedValue({ value: 999, stale: false });
  getCachedTaxonomy.mockResolvedValue({ value: TAXONOMY, stale: false });
  getCachedLabels.mockResolvedValue({ value: LABELS, stale: false });
});

describe("GET /api/v1/registry/taxonomy", () => {
  it("returns every record with servedFrom: static and asOfLedger populated", async () => {
    const res = await taxonomyGET(new NextRequest("https://orbital.example/api/v1/registry/taxonomy"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[]; servedFrom: string; asOfLedger: number };
    expect(body.data).toHaveLength(2);
    expect(body.servedFrom).toBe("static");
    expect(body.asOfLedger).toBe(999);
  });

  it("filters by category", async () => {
    const res = await taxonomyGET(
      new NextRequest("https://orbital.example/api/v1/registry/taxonomy?category=amm"),
    );
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toEqual(["t2"]);
  });
});

describe("GET /api/v1/registry/labels", () => {
  it("returns every record", async () => {
    const res = await labelsGET(new NextRequest("https://orbital.example/api/v1/registry/labels"));
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });

  it("filters by network", async () => {
    const res = await labelsGET(
      new NextRequest("https://orbital.example/api/v1/registry/labels?network=testnet"),
    );
    const body = (await res.json()) as { data: Array<{ contractId: string }> };
    expect(body.data.map((r) => r.contractId)).toEqual(["C2"]);
  });

  it("filters by tag", async () => {
    const res = await labelsGET(
      new NextRequest("https://orbital.example/api/v1/registry/labels?tag=governance"),
    );
    const body = (await res.json()) as { data: Array<{ contractId: string }> };
    expect(body.data.map((r) => r.contractId)).toEqual(["C2"]);
  });

  it("combines filters", async () => {
    const res = await labelsGET(
      new NextRequest(
        "https://orbital.example/api/v1/registry/labels?network=testnet&category=token&tag=amm",
      ),
    );
    const body = (await res.json()) as { data: Array<{ contractId: string }> };
    expect(body.data.map((r) => r.contractId)).toEqual(["C2"]);
  });
});
