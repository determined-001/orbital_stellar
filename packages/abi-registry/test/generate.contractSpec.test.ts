import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { generateContractArtifacts } from "../src/generate.js";
import { wellKnownToContractSpec } from "../src/wellKnown.js";
import type { ContractSpec } from "../src/spec.js";

const require = createRequire(import.meta.url);

const USDC_RAW = {
  version: "1.0.0",
  name: "USD Coin (USDC)",
  description: "test",
  contract_id: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  network: "mainnet" as const,
  source: "test",
  functions: [
    {
      name: "transfer",
      params: [
        { name: "from", type: "Address" },
        { name: "to", type: "Address" },
        { name: "amount", type: "i128" },
      ],
      outputs: [],
    },
    {
      name: "balance",
      params: [{ name: "id", type: "Address" }],
      outputs: [{ type: "i128" }],
    },
  ],
  events: [
    {
      name: "transfer",
      topics: [
        { name: "from", type: "Address" },
        { name: "to", type: "Address" },
      ],
      data: [{ name: "amount", type: "i128" }],
    },
  ],
};

describe("generateContractArtifacts - canonical ContractSpec path", () => {
  it("generates typed Params/Returns interfaces for each function", () => {
    const spec = wellKnownToContractSpec(USDC_RAW);
    const artifacts = generateContractArtifacts(spec);

    expect(artifacts.declarations).toContain("export interface TransferParams {");
    expect(artifacts.declarations).toContain("from: string;");
    expect(artifacts.declarations).toContain("to: string;");
    expect(artifacts.declarations).toContain("amount: string;");
    expect(artifacts.declarations).toContain("export type TransferReturns = void;");

    expect(artifacts.declarations).toContain("export interface BalanceParams {");
    expect(artifacts.declarations).toContain("id: string;");
    expect(artifacts.declarations).toContain("export type BalanceReturns = string;");
  });

  it("generates an event interface + zod schema from the event's data fields (not topics)", () => {
    const spec = wellKnownToContractSpec(USDC_RAW);
    const artifacts = generateContractArtifacts(spec);

    expect(artifacts.declarations).toContain("export interface TransferEvent {");
    expect(artifacts.declarations).toContain("amount: string;");
    // "from"/"to" are topics, not data - should not appear in the event's data interface.
    const eventInterfaceBlock = artifacts.declarations
      .split("export interface TransferEvent {")[1]!
      .split("}")[0]!;
    expect(eventInterfaceBlock).not.toContain("from:");
    expect(eventInterfaceBlock).not.toContain("to:");

    expect(artifacts.schemas).toContain("export const TransferEventSchema = z.object({");
  });

  it("generates struct, enum, and union UDT declarations", () => {
    const spec: ContractSpec = {
      version: "1.0.0",
      name: "Test",
      functions: [],
      events: [],
      types: {
        SpecRecord: {
          kind: "struct",
          name: "SpecRecord",
          fields: [
            { name: "version", type: "string" },
            { name: "publisher", type: "address" },
          ],
        },
        Status: {
          kind: "enum",
          name: "Status",
          variants: [
            { name: "Active", discriminant: 0 },
            { name: "Revoked", discriminant: 1 },
          ],
        },
        Shape: {
          kind: "union",
          name: "Shape",
          cases: [
            { name: "None", fields: [] },
            { name: "Circle", fields: [{ name: "_0", type: "u32" }] },
          ],
        },
      },
    };

    const artifacts = generateContractArtifacts(spec);

    expect(artifacts.declarations).toContain("export interface SpecRecord {");
    expect(artifacts.declarations).toContain("version: string;");
    expect(artifacts.declarations).toContain("publisher: string;");
    expect(artifacts.schemas).toContain("export const SpecRecordSchema = z.object({");

    expect(artifacts.declarations).toContain('export type Status = "Active" | "Revoked";');
    expect(artifacts.schemas).toContain(
      'export const StatusSchema = z.enum(["Active", "Revoked"]);',
    );

    expect(artifacts.declarations).toContain(
      'export type Shape = { case: "None" } | { case: "Circle"; values: [number] };',
    );
  });

  it("maps composite types: option, vec, map, tuple, bytes_n, named references", () => {
    const spec: ContractSpec = {
      version: "1.0.0",
      name: "Test",
      functions: [
        {
          name: "complex",
          params: [
            { name: "maybe", type: { type: "option", inner: "u32" } },
            { name: "list", type: { type: "vec", item: "address" } },
            {
              name: "table",
              type: { type: "map", key: "string", value: "i128" },
            },
            { name: "pair", type: { type: "tuple", elements: ["u32", "bool"] } },
            { name: "hash", type: { type: "bytes_n", size: 32 } },
            { name: "record", type: { type: "named", name: "SpecRecord" } },
          ],
          returns: "void",
        },
      ],
      events: [],
      types: {},
    };

    const artifacts = generateContractArtifacts(spec);
    expect(artifacts.declarations).toContain("maybe: number | null;");
    expect(artifacts.declarations).toContain("list: Array<string>;");
    expect(artifacts.declarations).toContain("table: Array<{ key: string; value: string }>;");
    expect(artifacts.declarations).toContain("pair: [number, boolean];");
    expect(artifacts.declarations).toContain("hash: string;");
    expect(artifacts.declarations).toContain("record: SpecRecord;");
  });

  it("the generated declarations are syntactically valid, standalone-compilable TypeScript", () => {
    const spec = wellKnownToContractSpec(USDC_RAW);
    // declarations only - schemas import zod, which isn't resolvable from a
    // bare temp dir with no node_modules; the interfaces/types are the
    // hand-generated, error-prone half anyway.
    const { declarations } = generateContractArtifacts(spec);
    const withoutZodImport = declarations.replace('import { z } from "zod";', "");

    const dir = mkdtempSync(join(tmpdir(), "orbital-typegen-"));
    const file = join(dir, "generated.ts");
    writeFileSync(file, withoutZodImport, "utf-8");

    // Compiles with no output and no thrown error == no syntax/type errors.
    try {
      execFileSync(
        process.execPath,
        [
          require.resolve("typescript/lib/tsc.js"),
          "--noEmit",
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          file,
        ],
        // cwd must be the isolated temp dir, not the test runner's cwd -
        // the latter has its own tsconfig.json, which trips TS5112 ("files
        // specified on commandline" conflicts with an ambient config).
        { stdio: "pipe", encoding: "utf-8", cwd: dir },
      );
    } catch (err) {
      const { stdout, stderr } = err as { stdout?: string; stderr?: string };
      throw new Error(`tsc failed:\n${stdout ?? ""}\n${stderr ?? ""}`);
    }
  }, 60_000);
});
