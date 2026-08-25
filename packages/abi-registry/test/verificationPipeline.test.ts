import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemorySpecStore, type RegisteredSpec } from "../src/specStore.js";
import { InMemoryVerdictStore, type VerdictRecord } from "../src/verdictStore.js";
import { ConsoleAlertManager, NoopAlertManager } from "../src/alertManager.js";
import { GitHubIssueReporter, NoopIssueReporter } from "../src/issueReporter.js";
import { runVerificationJob } from "../src/verificationJob.js";
import type { ContractSpec } from "../src/spec.js";
import type { SchemaVerdict } from "../src/verifySchema.js";

vi.mock("../src/verifySchema.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/verifySchema.js")>();
  return { ...actual, verifySchema: vi.fn() };
});

const { verifySchema } = await import("../src/verifySchema.js");
const mockVerify = vi.mocked(verifySchema);

const CONTRACT_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const CONTRACT_B = "CBWXJ3AJZ7Y57XZWZV75VZRRSCZ5DT5VLPKKSC6FYG4YI4ELO5AXBBVP";

function spec(name: string, version = "1.0.0"): ContractSpec {
  return { name, version, functions: [], events: [] };
}

function registered(contractId: string, name: string): RegisteredSpec {
  return { contractId, spec: spec(name), submittedAt: "2026-08-01T00:00:00.000Z" };
}

function jobConfig(overrides: Partial<Parameters<typeof runVerificationJob>[0]> = {}) {
  return {
    specStore: new InMemorySpecStore(),
    verdictStore: new InMemoryVerdictStore(),
    verifyOptions: { rpcUrl: "https://rpc.example" },
    ...overrides,
  };
}

describe("InMemorySpecStore", () => {
  it("registers, reads back, lists and removes", async () => {
    const store = new InMemorySpecStore();
    expect(await store.get(CONTRACT_A)).toBeNull();
    expect(await store.getAll()).toEqual([]);

    await store.register(registered(CONTRACT_A, "Token"));
    await store.register(registered(CONTRACT_B, "Pool"));

    expect((await store.get(CONTRACT_A))?.spec.name).toBe("Token");
    expect(await store.getAll()).toHaveLength(2);

    await store.remove(CONTRACT_A);
    expect(await store.get(CONTRACT_A)).toBeNull();
    expect(await store.getAll()).toHaveLength(1);
  });

  it("re-registering the same contract replaces rather than duplicates", async () => {
    const store = new InMemorySpecStore();
    await store.register(registered(CONTRACT_A, "Old"));
    await store.register(registered(CONTRACT_A, "New"));

    expect(await store.getAll()).toHaveLength(1);
    expect((await store.get(CONTRACT_A))?.spec.name).toBe("New");
  });
});

describe("InMemoryVerdictStore", () => {
  const verdict = (status: VerdictRecord["status"], at: string): VerdictRecord => ({
    contractId: CONTRACT_A,
    status,
    verifiedAt: at,
  });

  it("returns null and empty history for an unknown contract", async () => {
    const store = new InMemoryVerdictStore();
    expect(await store.getLatest(CONTRACT_A)).toBeNull();
    expect(await store.getHistory(CONTRACT_A)).toEqual([]);
    expect(await store.getAll()).toEqual([]);
  });

  it("keeps full history but reports only the newest as latest", async () => {
    const store = new InMemoryVerdictStore();
    await store.record(verdict("verified", "2026-08-01T00:00:00.000Z"));
    await store.record(verdict("mismatch", "2026-08-02T00:00:00.000Z"));

    expect(await store.getHistory(CONTRACT_A)).toHaveLength(2);
    expect((await store.getLatest(CONTRACT_A))?.status).toBe("mismatch");
  });

  it("getAll reports one newest record per contract, not the whole history", async () => {
    const store = new InMemoryVerdictStore();
    await store.record(verdict("verified", "2026-08-01T00:00:00.000Z"));
    await store.record(verdict("mismatch", "2026-08-02T00:00:00.000Z"));
    await store.record({
      contractId: CONTRACT_B,
      status: "unverifiable",
      verifiedAt: "2026-08-02T00:00:00.000Z",
    });

    const all = await store.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.status).sort()).toEqual(["mismatch", "unverifiable"]);
  });
});

describe("alert managers", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  const prev: VerdictRecord = {
    contractId: CONTRACT_A,
    status: "verified",
    verifiedAt: "2026-08-01T00:00:00.000Z",
  };

  it("ConsoleAlertManager names both sides of the transition", async () => {
    await new ConsoleAlertManager().alertTransition(prev, {
      ...prev,
      status: "mismatch",
      verifiedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const message = String(consoleError.mock.calls[0]![0]);
    expect(message).toContain(CONTRACT_A);
    expect(message).toContain('"verified"');
    expect(message).toContain('"mismatch"');
  });

  it("ConsoleAlertManager logs diffs as a second line when present", async () => {
    await new ConsoleAlertManager().alertTransition(prev, {
      ...prev,
      status: "mismatch",
      diffs: [{ path: "functions.0.name", submitted: "swap", onChain: "exchange" }],
    });

    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(String(consoleError.mock.calls[1]![1])).toContain("functions.0.name");
  });

  it("ConsoleAlertManager stays on one line for an empty diff array", async () => {
    await new ConsoleAlertManager().alertTransition(prev, { ...prev, diffs: [] });
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("NoopAlertManager is silent", async () => {
    await new NoopAlertManager().alertTransition(prev, prev);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("GitHubIssueReporter", () => {
  afterEach(() => vi.unstubAllGlobals());

  const params = {
    contractId: CONTRACT_A,
    contractName: "Token",
    diffs: [{ path: "events.0.name", submitted: "transfer", onChain: "Transfer" }],
    submittedVersion: "1.0.0",
    previousStatus: "verified",
  };

  it("posts a titled, labelled issue and returns its URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ html_url: "https://github.com/o/r/issues/7" }), {
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const url = await new GitHubIssueReporter("tok", "o/r").reportMismatch(params);
    expect(url).toBe("https://github.com/o/r/issues/7");

    const [endpoint, init] = fetchMock.mock.calls[0]!;
    expect(endpoint).toBe("https://api.github.com/repos/o/r/issues");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });

    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.title).toContain("Token");
    expect(sent.labels).toContain("schema-mismatch");
    expect(sent.body).toContain("events.0.name");
    expect(sent.body).toContain("| **Submitted version** | 1.0.0 |");
  });

  it("falls back to the repo issues URL when the response carries no html_url", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 201 })),
    );
    const url = await new GitHubIssueReporter("tok", "o/r").reportMismatch(params);
    expect(url).toBe("https://github.com/o/r/issues");
  });

  it("reports the status and body when GitHub rejects the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad credentials", { status: 401 })),
    );

    await expect(new GitHubIssueReporter("tok", "o/r").reportMismatch(params)).rejects.toThrow(
      /failed to create issue \(401\): bad credentials/,
    );
  });

  it("renders a no-diffs body without a diff table", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ html_url: "u" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new GitHubIssueReporter("tok", "o/r").reportMismatch({
      contractId: CONTRACT_A,
      contractName: "Token",
      diffs: [],
    });

    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(sent.body).toContain("No specific field diffs recorded.");
    expect(sent.body).not.toContain("**Submitted version**");
  });

  it("NoopIssueReporter reports nothing and returns an empty string", async () => {
    expect(await new NoopIssueReporter().reportMismatch(params)).toBe("");
  });
});

describe("runVerificationJob", () => {
  beforeEach(() => mockVerify.mockReset());

  it("returns a zeroed result for an empty spec store", async () => {
    const result = await runVerificationJob(jobConfig());
    expect(result).toMatchObject({ total: 0, verified: 0, mismatch: 0, unverifiable: 0 });
    expect(result.errors).toEqual([]);
  });

  it("counts each verdict kind and records one verdict per contract", async () => {
    const specStore = new InMemorySpecStore();
    const verdictStore = new InMemoryVerdictStore();
    await specStore.register(registered(CONTRACT_A, "Token"));
    await specStore.register(registered(CONTRACT_B, "Pool"));

    mockVerify
      .mockResolvedValueOnce({ status: "match" } satisfies SchemaVerdict)
      .mockResolvedValueOnce({
        status: "unverifiable",
        reason: "no embedded spec",
      } satisfies SchemaVerdict);

    const seen: VerdictRecord[] = [];
    const result = await runVerificationJob(
      jobConfig({ specStore, verdictStore, onVerdict: (r) => seen.push(r) }),
    );

    expect(result).toMatchObject({ total: 2, verified: 1, mismatch: 0, unverifiable: 1 });
    expect(seen).toHaveLength(2);
    expect((await verdictStore.getLatest(CONTRACT_B))?.reason).toBe("no embedded spec");
  });

  it("opens an issue for a mismatch and carries the diffs onto the record", async () => {
    const specStore = new InMemorySpecStore();
    const verdictStore = new InMemoryVerdictStore();
    await specStore.register(registered(CONTRACT_A, "Token"));

    const diffs = [{ path: "functions.0.name", submitted: "swap", onChain: "exchange" }];
    mockVerify.mockResolvedValue({ status: "mismatch", diffs } satisfies SchemaVerdict);

    const issueReporter = {
      reportMismatch: vi.fn(async () => "https://github.com/o/r/issues/1"),
    };
    const result = await runVerificationJob(jobConfig({ specStore, verdictStore, issueReporter }));

    expect(result.mismatch).toBe(1);
    expect(result.issuesCreated).toEqual(["https://github.com/o/r/issues/1"]);
    expect(issueReporter.reportMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ contractName: "Token", diffs }),
    );
    expect((await verdictStore.getLatest(CONTRACT_A))?.diffs).toEqual(diffs);
  });

  it("does not record an issue URL when the reporter returns an empty string", async () => {
    const specStore = new InMemorySpecStore();
    await specStore.register(registered(CONTRACT_A, "Token"));
    mockVerify.mockResolvedValue({ status: "mismatch", diffs: [] } satisfies SchemaVerdict);

    const result = await runVerificationJob(
      jobConfig({ specStore, issueReporter: new NoopIssueReporter() }),
    );
    expect(result.issuesCreated).toEqual([]);
  });

  it("alerts only when the status actually changes between runs", async () => {
    const specStore = new InMemorySpecStore();
    const verdictStore = new InMemoryVerdictStore();
    await specStore.register(registered(CONTRACT_A, "Token"));
    const alertManager = { alertTransition: vi.fn(async () => {}) };

    mockVerify.mockResolvedValue({ status: "match" } satisfies SchemaVerdict);
    await runVerificationJob(jobConfig({ specStore, verdictStore, alertManager }));
    expect(alertManager.alertTransition).not.toHaveBeenCalled();

    // Second run, same verdict: still no transition.
    await runVerificationJob(jobConfig({ specStore, verdictStore, alertManager }));
    expect(alertManager.alertTransition).not.toHaveBeenCalled();

    // Third run flips to mismatch, which is a transition worth alerting on.
    mockVerify.mockResolvedValue({ status: "mismatch", diffs: [] } satisfies SchemaVerdict);
    await runVerificationJob(jobConfig({ specStore, verdictStore, alertManager }));

    expect(alertManager.alertTransition).toHaveBeenCalledTimes(1);
    const [previous, current] = alertManager.alertTransition.mock.calls[0]!;
    expect((previous as VerdictRecord).status).toBe("verified");
    expect((current as VerdictRecord).status).toBe("mismatch");
  });

  it("captures a per-contract failure and keeps going", async () => {
    const specStore = new InMemorySpecStore();
    await specStore.register(registered(CONTRACT_A, "Broken"));
    await specStore.register(registered(CONTRACT_B, "Fine"));

    mockVerify
      .mockRejectedValueOnce(new Error("rpc unreachable"))
      .mockResolvedValueOnce({ status: "match" } satisfies SchemaVerdict);

    const result = await runVerificationJob(jobConfig({ specStore }));

    expect(result.total).toBe(2);
    expect(result.verified).toBe(1);
    expect(result.errors).toEqual([{ contractId: CONTRACT_A, error: "rpc unreachable" }]);
  });

  it("stringifies a non-Error throw rather than dropping it", async () => {
    const specStore = new InMemorySpecStore();
    await specStore.register(registered(CONTRACT_A, "Token"));
    mockVerify.mockImplementationOnce(async () => {
      // Deliberately not an Error - the job must stringify whatever it catches.
      throw "boom";
    });

    const result = await runVerificationJob(jobConfig({ specStore }));
    expect(result.errors).toEqual([{ contractId: CONTRACT_A, error: "boom" }]);
  });
});
