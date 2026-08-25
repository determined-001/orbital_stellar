import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";

describe("Open Data Artifacts (#912)", () => {
  const rootDir = path.resolve(__dirname, "../../../");
  const dataDir = path.join(rootDir, "data");
  const webPublicDataDir = path.join(rootDir, "apps/web/public/data");

  const taxonomyPath = path.join(dataDir, "taxonomy.json");
  const labelsPath = path.join(dataDir, "labels.json");
  const integrityPath = path.join(dataDir, "integrity.json");
  const licensePath = path.join(dataDir, "LICENSE");

  it("should have all required open data files in data/", () => {
    expect(fs.existsSync(taxonomyPath)).toBe(true);
    expect(fs.existsSync(labelsPath)).toBe(true);
    expect(fs.existsSync(integrityPath)).toBe(true);
    expect(fs.existsSync(licensePath)).toBe(true);
  });

  it("should have matching public static assets in apps/web/public/data/", () => {
    expect(fs.existsSync(path.join(webPublicDataDir, "taxonomy.json"))).toBe(true);
    expect(fs.existsSync(path.join(webPublicDataDir, "labels.json"))).toBe(true);
    expect(fs.existsSync(path.join(webPublicDataDir, "integrity.json"))).toBe(true);
    expect(fs.existsSync(path.join(webPublicDataDir, "LICENSE"))).toBe(true);
  });

  it("should validate taxonomy.json schema metadata and record count", () => {
    const content = JSON.parse(fs.readFileSync(taxonomyPath, "utf-8"));
    expect(content.schemaVersion).toBe("1.0.0");
    expect(typeof content.generatedAt).toBe("string");
    expect(typeof content.recordCount).toBe("number");
    expect(content.recordCount).toBeGreaterThan(0);
    expect(Array.isArray(content.records)).toBe(true);
    expect(content.records.length).toBe(content.recordCount);
  });

  it("should validate labels.json schema metadata and record count", () => {
    const content = JSON.parse(fs.readFileSync(labelsPath, "utf-8"));
    expect(content.schemaVersion).toBe("1.0.0");
    expect(typeof content.generatedAt).toBe("string");
    expect(typeof content.recordCount).toBe("number");
    expect(content.recordCount).toBeGreaterThan(0);
    expect(Array.isArray(content.records)).toBe(true);
    expect(content.records.length).toBe(content.recordCount);
  });

  it("should cover every NormalizedEvent type pulse-core can emit", () => {
    // The `describeEvent` switch in pulse-core is exhaustive over
    // `NormalizedEvent` (its default branch assigns to `never`), so its case
    // labels are the authoritative list of event types. Deriving from it here
    // means adding an event to pulse-core without adding it to the taxonomy
    // fails CI instead of silently shipping stale open data.
    const narrowSource = fs.readFileSync(
      path.join(rootDir, "packages/pulse-core/src/eventAddressNarrow.ts"),
      "utf-8",
    );
    const emitted = [...narrowSource.matchAll(/case "([a-z]+\.[a-z_]+)":/g)].map((m) => m[1]);
    expect(emitted.length).toBeGreaterThan(0);

    const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, "utf-8"));
    const covered = new Set(taxonomy.records.map((r: { eventType: string }) => r.eventType));

    expect([...new Set(emitted)].filter((t) => !covered.has(t))).toEqual([]);
  });

  it("should verify SHA-256 integrity manifest digests", () => {
    const integrity = JSON.parse(fs.readFileSync(integrityPath, "utf-8"));
    expect(integrity.schemaVersion).toBe("1.0.0");
    expect(integrity.files).toBeDefined();

    const taxonomyRaw = fs.readFileSync(taxonomyPath, "utf-8");
    const labelsRaw = fs.readFileSync(labelsPath, "utf-8");
    const licenseRaw = fs.readFileSync(licensePath, "utf-8");

    const taxonomySha = crypto.createHash("sha256").update(taxonomyRaw).digest("hex");
    const labelsSha = crypto.createHash("sha256").update(labelsRaw).digest("hex");
    const licenseSha = crypto.createHash("sha256").update(licenseRaw).digest("hex");

    expect(integrity.files["taxonomy.json"].sha256).toBe(taxonomySha);
    expect(integrity.files["labels.json"].sha256).toBe(labelsSha);
    expect(integrity.files["LICENSE"].sha256).toBe(licenseSha);
  });
});
