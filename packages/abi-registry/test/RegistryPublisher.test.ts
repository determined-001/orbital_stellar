import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LocalFilePublisher } from "../src/RegistryPublisher.js";

// Load a known-good spec from the well-known directory.
const VALID_SPEC = JSON.parse(
  readFileSync(
    resolve(__dirname, "../specs/well-known/aqua.json"),
    "utf-8"
  )
);

describe("LocalFilePublisher", () => {
  it("accepts a fully-valid spec and returns metadata", async () => {
    const publisher = new LocalFilePublisher();
    const result = await publisher.publish(VALID_SPEC);

    expect(result.contractId).toBe(VALID_SPEC.contract_id);
    expect(result.version).toBe("local");
    expect(result.etag).toContain("local-");
  });

  it("rejects an invalid spec with a list of validation errors", async () => {
    const publisher = new LocalFilePublisher();

    await expect(
      publisher.publish({ contractId: "bad-contract" })
    ).rejects.toThrow("Spec validation failed:");
  });

  it("error message lists every missing required field", async () => {
    const publisher = new LocalFilePublisher();

    let errorMessage = "";
    try {
      await publisher.publish({});
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    // schema requires: version, name, description, contract_id, network, source, functions
    expect(errorMessage).toContain('missing required property "version"');
    expect(errorMessage).toContain('missing required property "functions"');
  });
});