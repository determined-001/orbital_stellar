import { describe, expect, it } from "vitest";
import { LocalFilePublisher } from "../src/RegistryPublisher.js";

describe("LocalFilePublisher", () => {
  it("publishes a spec and returns metadata", async () => {
    const publisher = new LocalFilePublisher();

    const result = await publisher.publish({
      contractId: "test-contract",
    });

    expect(result.contractId).toBe("test-contract");
    expect(result.version).toBe("local");
    expect(result.etag).toContain("local-");
  });
});