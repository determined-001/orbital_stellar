import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as getVerdicts } from "@/app/api/workers/verdicts/route";
import { GET as getOperators } from "@/app/api/workers/operators/route";
import { __resetRegistryReadPolicyForTests } from "@/lib/registryReadPolicy";
import { VERDICT_SCHEMA_VERSION } from "@/lib/verification";
import { SCORE_FORMULA_VERSION } from "@orbital-stellar/worker-core";

function req(url: string, ip: string): NextRequest {
  return new NextRequest(url, { headers: { "x-vercel-forwarded-for": ip } });
}

let counter = 0;
const freshIp = () => `198.51.100.${++counter % 250}${Math.floor(counter / 250)}`;

const SEEDED_WORKER = "GSETTLEMENTDESKALPHA0000000000000000000000000000000000";

describe("GET /api/workers/verdicts", () => {
  it("requires a worker query param", async () => {
    const res = await getVerdicts(req("https://orbital.example/api/workers/verdicts", freshIp()));
    expect(res.status).toBe(400);
  });

  it("rejects a non-integer start_ledger", async () => {
    const res = await getVerdicts(
      req(
        `https://orbital.example/api/workers/verdicts?worker=${SEEDED_WORKER}&start_ledger=abc`,
        freshIp(),
      ),
    );
    expect(res.status).toBe(400);
  });

  it("returns seeded verdicts for a known worker, stamped with the verdict schema version", async () => {
    __resetRegistryReadPolicyForTests();
    const res = await getVerdicts(
      req(`https://orbital.example/api/workers/verdicts?worker=${SEEDED_WORKER}`, freshIp()),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { meta: { schemaVersion: number }; data: unknown[] };
    expect(body.meta.schemaVersion).toBe(VERDICT_SCHEMA_VERSION);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("returns an empty list for a worker with no recorded verdicts", async () => {
    __resetRegistryReadPolicyForTests();
    const res = await getVerdicts(
      req("https://orbital.example/api/workers/verdicts?worker=GNOTHINGHERE", freshIp()),
    );
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("filters out verdicts whose window falls outside the requested ledger range", async () => {
    __resetRegistryReadPolicyForTests();
    const all = await getVerdicts(
      req(`https://orbital.example/api/workers/verdicts?worker=${SEEDED_WORKER}`, freshIp()),
    );
    const { data: allVerdicts } = (await all.json()) as {
      data: { window: { startLedger: number; endLedger: number } }[];
    };
    expect(allVerdicts.length).toBeGreaterThan(1);

    // Pick the most recent window and shift the query's start_ledger one
    // past its own start: the adjacent older window's endLedger equals this
    // window's startLedger, and an inclusive overlap check would otherwise
    // still match it at that exact boundary.
    const latest = [...allVerdicts].sort((a, b) => b.window.endLedger - a.window.endLedger)[0]!;
    const narrowed = await getVerdicts(
      req(
        `https://orbital.example/api/workers/verdicts?worker=${SEEDED_WORKER}&start_ledger=${latest.window.startLedger + 1}&end_ledger=${latest.window.endLedger}`,
        freshIp(),
      ),
    );
    const { data: narrowedVerdicts } = (await narrowed.json()) as { data: unknown[] };
    expect(narrowedVerdicts.length).toBeLessThan(allVerdicts.length);
  });
});

describe("GET /api/workers/operators", () => {
  it("requires an operator query param", async () => {
    const res = await getOperators(req("https://orbital.example/api/workers/operators", freshIp()));
    expect(res.status).toBe(400);
  });

  it("returns a score and metrics stamped with the score formula version", async () => {
    __resetRegistryReadPolicyForTests();
    const res = await getOperators(
      req("https://orbital.example/api/workers/operators?operator=settlement-desk-alpha", freshIp()),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      meta: { formulaVersion: string };
      data: { score: unknown; metrics: unknown };
    };
    expect(body.meta.formulaVersion).toBe(SCORE_FORMULA_VERSION);
    expect(body.data.score).toBeDefined();
    expect(body.data.metrics).toBeDefined();
  });

  it("reports insufficient_data for an operator with too few verdicts", async () => {
    __resetRegistryReadPolicyForTests();
    const res = await getOperators(
      req("https://orbital.example/api/workers/operators?operator=newco-operator", freshIp()),
    );
    const body = (await res.json()) as { data: { score: { status: string } } };
    expect(body.data.score.status).toBe("insufficient_data");
  });
});
