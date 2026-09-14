import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCachedLedgerSequence } = vi.hoisted(() => ({
  getCachedLedgerSequence: vi.fn(),
}));

vi.mock("@/lib/hostedRegistryApi", () => ({ getCachedLedgerSequence }));

import { GET } from "@/app/api/v1/registry/health/route";

beforeEach(() => {
  getCachedLedgerSequence.mockReset();
});

describe("GET /api/v1/registry/health", () => {
  it("reports ok with the last-sync ledger", async () => {
    getCachedLedgerSequence.mockResolvedValue({ value: 4536200, stale: false });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; lastSyncLedger: number; stale: boolean };
    expect(body.status).toBe("ok");
    expect(body.lastSyncLedger).toBe(4536200);
    expect(body.stale).toBe(false);
  });

  it("still reports ok (not degraded) when serving a stale-but-successful ledger read", async () => {
    getCachedLedgerSequence.mockResolvedValue({ value: 4536200, stale: true });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; stale: boolean };
    expect(body.status).toBe("ok");
    expect(body.stale).toBe(true);
  });

  it("reports degraded with lastSyncLedger: null when Soroban RPC is unreachable", async () => {
    getCachedLedgerSequence.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; lastSyncLedger: number | null };
    expect(body.status).toBe("degraded");
    expect(body.lastSyncLedger).toBeNull();
  });
});
