import { describe, it, expect, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  loadSubmittedSchema,
  runVerify,
  formatVerdict,
  VERIFY_EXIT_CODES,
} from "../src/cli/verify.js";
import type { ContractSpec } from "../src/spec.js";
import type { SchemaVerdict } from "../src/verifySchema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USDC_WELL_KNOWN = resolve(__dirname, "../specs/well-known/usdc.json");
const USDC_CONTRACT_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const CANONICAL_SPEC: ContractSpec = {
  version: "1.0.0",
  name: "demo-emitter",
  contractId: USDC_CONTRACT_ID,
  network: "testnet",
  functions: [{ name: "ping", params: [], returns: "u32" }],
  events: [],
  types: {},
};

function stubVerify(verdict: SchemaVerdict) {
  return vi.fn(async () => verdict) as never;
}

function baseOptions(overrides: Partial<Parameters<typeof runVerify>[0]> = {}) {
  return {
    contractId: USDC_CONTRACT_ID,
    schemaPath: USDC_WELL_KNOWN,
    rpcUrl: "https://soroban-testnet.stellar.org",
    network: "mainnet" as const,
    ...overrides,
  };
}

describe("loadSubmittedSchema", () => {
  it("loads a bundled well-known spec in the hand-authored snake_case format", () => {
    const spec = loadSubmittedSchema(USDC_WELL_KNOWN);

    expect(spec.contractId).toBe(USDC_CONTRACT_ID);
    expect(spec.functions.some((fn) => fn.name === "transfer")).toBe(true);
  });

  it("loads a canonical ContractSpec unchanged", () => {
    const spec = loadSubmittedSchema("/spec.json", () => JSON.stringify(CANONICAL_SPEC));

    expect(spec).toEqual(CANONICAL_SPEC);
  });

  it("throws when the file is unreadable", () => {
    expect(() =>
      loadSubmittedSchema("/missing.json", () => {
        throw new Error("ENOENT: no such file or directory");
      }),
    ).toThrow(/Could not read schema file "\/missing.json"/);
  });

  it("throws when the file is not a valid ContractSpec", () => {
    expect(() =>
      loadSubmittedSchema("/spec.json", () => JSON.stringify({ version: "nope" })),
    ).toThrow(/is not a valid ContractSpec/);
  });
});

describe("runVerify", () => {
  it("exits 0 and reports a match against a bundled well-known contract", async () => {
    const verify = stubVerify({ status: "match" });

    const result = await runVerify(baseOptions(), { verify });

    expect(result.exitCode).toBe(0);
    expect(result.exitCode).toBe(VERIFY_EXIT_CODES.match);
    expect(result.stdout).toContain("✓ match");
    expect(result.stdout).toContain(USDC_CONTRACT_ID);
    expect(result.stderr).toBe("");
  });

  it("passes the rpc url and network through to verifySchema", async () => {
    const verify = vi.fn(async () => ({ status: "match" }) as SchemaVerdict);

    await runVerify(baseOptions({ rpcUrl: "https://rpc.example.com" }), {
      verify: verify as never,
    });

    expect(verify).toHaveBeenCalledWith(USDC_CONTRACT_ID, expect.objectContaining({}), {
      rpcUrl: "https://rpc.example.com",
      network: "mainnet",
    });
  });

  it("exits non-zero on mismatch and prints every field-level diff", async () => {
    const verify = stubVerify({
      status: "mismatch",
      diffs: [
        { path: "functions[transfer].returns", submitted: "void", onChain: "u32" },
        { path: "events[Transfer]", submitted: undefined, onChain: "Transfer" },
      ],
    });

    const result = await runVerify(baseOptions(), { verify });

    expect(result.exitCode).toBe(VERIFY_EXIT_CODES.mismatch);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("✗ mismatch");
    expect(result.stdout).toContain("2 difference(s)");
    expect(result.stdout).toContain("functions[transfer].returns");
    expect(result.stdout).toContain("events[Transfer]");
    expect(result.stdout).toContain("(absent)");
  });

  it("exits 2 when the contract has no embedded spec", async () => {
    const verify = stubVerify({ status: "unverifiable", reason: "no embedded contractspec" });

    const result = await runVerify(baseOptions(), { verify });

    expect(result.exitCode).toBe(VERIFY_EXIT_CODES.unverifiable);
    expect(result.stdout).toContain("? unverifiable");
    expect(result.stdout).toContain("no embedded contractspec");
  });

  it("exits 0 for unverifiable when --allow-unverifiable is set", async () => {
    const verify = stubVerify({ status: "unverifiable", reason: "no embedded contractspec" });

    const result = await runVerify(baseOptions({ allowUnverifiable: true }), { verify });

    expect(result.exitCode).toBe(0);
  });

  it("prints the structured verdict as JSON with --json", async () => {
    const verify = stubVerify({
      status: "mismatch",
      diffs: [{ path: "functions.length", submitted: 1, onChain: 2 }],
    });

    const result = await runVerify(baseOptions({ json: true }), { verify });

    expect(result.exitCode).toBe(VERIFY_EXIT_CODES.mismatch);
    expect(JSON.parse(result.stdout)).toEqual({
      contractId: USDC_CONTRACT_ID,
      status: "mismatch",
      diffs: [{ path: "functions.length", submitted: 1, onChain: 2 }],
    });
  });

  it("exits 3 with the reason on stderr when the schema file cannot be loaded", async () => {
    const verify = stubVerify({ status: "match" });

    const result = await runVerify(baseOptions({ schemaPath: "/missing.json" }), {
      verify,
      readFile: () => {
        throw new Error("ENOENT: no such file or directory");
      },
    });

    expect(result.exitCode).toBe(VERIFY_EXIT_CODES.error);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Could not read schema file");
    expect(verify).not.toHaveBeenCalled();
  });

  it("exits 3 when the RPC lookup fails", async () => {
    const verify = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    const result = await runVerify(baseOptions(), { verify: verify as never });

    expect(result.exitCode).toBe(VERIFY_EXIT_CODES.error);
    expect(result.stderr).toContain("Verification failed: fetch failed");
  });
});

describe("formatVerdict", () => {
  it("renders undefined diff sides as (absent) rather than dropping them", () => {
    const output = formatVerdict(USDC_CONTRACT_ID, {
      status: "mismatch",
      diffs: [{ path: "functions[burn]", submitted: "burn", onChain: undefined }],
    });

    expect(output).toContain('submitted: "burn"');
    expect(output).toContain("on-chain:  (absent)");
  });
});
