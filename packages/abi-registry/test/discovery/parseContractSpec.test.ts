import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { StrKey } from "@stellar/stellar-sdk";
import { parseWasmSpec, NoEmbeddedSpecError } from "../../src/discovery/parseContractSpec.js";
import { validateSpec } from "../../src/spec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../fixtures");

function loadFixture(name: string): Buffer {
  return readFileSync(resolve(FIXTURES_DIR, name));
}

// A minimal, valid, empty WASM module: magic + version, zero sections.
const EMPTY_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe("parseWasmSpec - real WASM fixtures (contracts/demo-emitter, contracts/registry)", () => {
  it("parses demo-emitter.wasm: one Ping event, one ping() function", () => {
    const parsed = parseWasmSpec(loadFixture("demo-emitter.wasm"));

    expect(parsed.functions).toHaveLength(1);
    const ping = parsed.functions[0]!;
    expect(ping.name).toBe("ping");
    expect(ping.params).toEqual([]);
    expect(ping.returns).toBe("u32");

    expect(parsed.events).toHaveLength(1);
    const pingEvent = parsed.events[0]!;
    expect(pingEvent.name).toBe("Ping");
    // event_name (synthetic prefix topic) + count (the #[topic] field)
    expect(pingEvent.topics.map((t) => t.name)).toEqual(["event_name", "count"]);
    expect(pingEvent.topics[0]).toEqual(
      expect.objectContaining({ name: "event_name", type: "symbol" }),
    );
    expect(pingEvent.topics[1]).toEqual({ name: "count", type: "u32" });
    expect(pingEvent.data).toEqual([{ name: "timestamp", type: "u64" }]);

    expect(parsed.types).toEqual({});
    expect(parsed.xdrEntries.length).toBeGreaterThan(0);
  });

  it("parses registry.wasm: 4 functions, 1 event, a struct type, an error enum type", () => {
    const parsed = parseWasmSpec(loadFixture("registry.wasm"));

    const fnNames = parsed.functions.map((f) => f.name).sort();
    expect(fnNames).toEqual([
      "get_version",
      "latest",
      "list_versions",
      "list_versions_paged",
      "publish",
    ]);

    const publish = parsed.functions.find((f) => f.name === "publish")!;
    expect(publish.params.map((p) => p.name)).toEqual([
      "publisher",
      "contract_id",
      "version",
      "spec_hash",
      "pointer",
    ]);
    expect(publish.params.map((p) => p.type)).toEqual([
      "address",
      "address",
      "string",
      { type: "bytes_n", size: 32 },
      "string",
    ]);
    // Result<(), Error> - the XDR spec encodes the err arm as the generic
    // "error" primitive, not a named reference to the Error UDT (verified).
    expect(publish.returns).toEqual({ type: "result", ok: "void", err: "error" });

    const latest = parsed.functions.find((f) => f.name === "latest")!;
    expect(latest.returns).toEqual({
      type: "option",
      inner: { type: "named", name: "SpecRecord" },
    });

    const listVersions = parsed.functions.find((f) => f.name === "list_versions")!;
    expect(listVersions.returns).toEqual({ type: "vec", item: "string" });

    const listVersionsPaged = parsed.functions.find((f) => f.name === "list_versions_paged")!;
    expect(listVersionsPaged).toBeDefined();
    expect(listVersionsPaged.params).toHaveLength(4);
    expect(listVersionsPaged.returns).toEqual({
      type: "tuple",
      elements: [
        { type: "vec", item: "string" },
        { type: "option", inner: "i32" },
      ],
    });

    expect(parsed.events).toHaveLength(1);
    const published = parsed.events[0]!;
    expect(published.name).toBe("SpecPublished");
    expect(published.topics.map((t) => t.name)).toEqual(["event_name", "contract_id", "version"]);
    expect(published.data.map((d) => d.name)).toEqual(["spec_hash", "pointer", "publisher"]);

    expect(Object.keys(parsed.types).sort()).toEqual(["Error", "SpecRecord"]);
    expect(parsed.types["SpecRecord"]).toMatchObject({ kind: "struct", name: "SpecRecord" });
    expect(parsed.types["Error"]).toMatchObject({ kind: "enum", name: "Error" });
    const errorType = parsed.types["Error"] as { kind: "enum"; variants: { name: string }[] };
    expect(errorType.variants.map((v) => v.name).sort()).toEqual([
      "AlreadyPublished",
      "EmptyPointer",
      "EmptyVersion",
    ]);
  });

  it("produces a spec that validates once wrapped with contractId/version/name (as discoverContractSpec does)", () => {
    const parsed = parseWasmSpec(loadFixture("demo-emitter.wasm"));
    const contractId = StrKey.encodeContract(Buffer.alloc(32, 9));
    const spec = {
      version: "0.0.0",
      name: contractId,
      contractId,
      functions: parsed.functions,
      events: parsed.events,
      types: parsed.types,
      xdrEntries: parsed.xdrEntries,
    };
    const result = validateSpec(spec);
    expect(result.valid, result.valid ? "" : JSON.stringify((result as any).errors)).toBe(true);
  });
});

describe("parseWasmSpec - error cases", () => {
  it("throws NoEmbeddedSpecError for a WASM binary with no contractspecv0 section", () => {
    expect(() => parseWasmSpec(EMPTY_WASM)).toThrow(NoEmbeddedSpecError);
  });

  it("throws a clear error for a non-WASM buffer (bad magic number)", () => {
    expect(() => parseWasmSpec(Buffer.from("not a wasm file"))).toThrow(/bad magic number/);
  });
});
