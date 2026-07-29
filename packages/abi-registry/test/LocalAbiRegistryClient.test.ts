import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalAbiRegistryClient } from "../src/LocalAbiRegistryClient.js";

describe("LocalAbiRegistryClient", () => {
  let testDir: string;
  let client: LocalAbiRegistryClient;
  const contractId = "C" + "A".repeat(55);

  beforeEach(() => {
    testDir = join(tmpdir(), `local-abi-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    client = new LocalAbiRegistryClient({
      specsDir: testDir,
    });
  });

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should create client with config", () => {
    expect(client).toBeDefined();
  });

  it("should handle trailing slash in specsDir", () => {
    const clientWithSlash = new LocalAbiRegistryClient({
      specsDir: testDir + "/",
    });
    expect(clientWithSlash).toBeDefined();
  });

  it("should return null for non-existent spec", async () => {
    const spec = await client.getSpec(contractId);
    expect(spec).toBeNull();
  });

  it("should load spec from disk when file exists", async () => {
    const specContent = "valid-xdr-content";
    writeFileSync(
      join(testDir, `${contractId}.json`),
      JSON.stringify({
        contractId,
        xdr: specContent,
      }),
    );

    const spec = await client.getSpec(contractId);
    expect(spec).toBeDefined();
  });

  it("should cache specs after loading", async () => {
    const specContent = "valid-xdr-content";
    writeFileSync(
      join(testDir, `${contractId}.json`),
      JSON.stringify({
        contractId,
        xdr: specContent,
      }),
    );

    // First call loads from disk
    const spec1 = await client.getSpec(contractId);
    // Second call should use cache
    const spec2 = await client.getSpec(contractId);

    expect(spec1).toEqual(spec2);
  });

  it("should handle multiple specs", async () => {
    const contractId2 = "C" + "B".repeat(55);

    writeFileSync(
      join(testDir, `${contractId}.json`),
      JSON.stringify({
        contractId,
        xdr: "content1",
      }),
    );

    writeFileSync(
      join(testDir, `${contractId2}.json`),
      JSON.stringify({
        contractId: contractId2,
        xdr: "content2",
      }),
    );

    const specs = await client.getSpecs([contractId, contractId2]);

    expect(Object.keys(specs)).toHaveLength(2);
    expect(specs[contractId]).toBeDefined();
    expect(specs[contractId2]).toBeDefined();
  });
});
