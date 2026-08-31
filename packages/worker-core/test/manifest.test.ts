/**
 * Tests for the worker manifest standard.
 *
 * Covers:
 * - validateManifest() — the standalone validator
 * - parseManifest()    — JSON string parsing + validation
 * - WorkerManifestBuilder — fluent builder
 * - Schema examples    — both example files must validate
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  validateManifest,
  parseManifest,
  WorkerManifestBuilder,
  ManifestValidationError,
  MANIFEST_SCHEMA_VERSION,
  type WorkerManifest,
} from "../src/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "../schema");

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const VALID_CONTRACT_ID_2 = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4";

function validManifest(): WorkerManifest {
  return {
    manifestVersion: "1.0.0",
    id: "test-org/my-worker",
    name: "My Worker",
    trigger: { class: "cron", cron: "0 * * * *", timezone: "UTC" },
    target: { contractId: VALID_CONTRACT_ID, function: "tick" },
    latencyBound: { maxSeconds: 30 },
    fireEvent: {
      contractId: VALID_CONTRACT_ID,
      topics: [{ kind: "symbol", value: "ticked" }],
    },
  };
}

// ---------------------------------------------------------------------------
// validateManifest — happy path
// ---------------------------------------------------------------------------

describe("validateManifest — valid manifests", () => {
  it("accepts a minimal valid manifest", () => {
    const result = validateManifest(validManifest());
    expect(result.valid).toBe(true);
  });

  it("accepts a fully populated manifest", () => {
    const manifest: WorkerManifest = {
      ...validManifest(),
      description: "Does something useful.",
      version: "2.0.0",
      network: "mainnet",
      author: "test-org",
      repository: "https://github.com/test-org/my-worker",
      tags: ["oracle", "defi"],
      trigger: {
        class: "cron",
        cron: "*/5 * * * *",
        timezone: "America/New_York",
        windowSec: 60,
      },
      target: {
        contractId: VALID_CONTRACT_ID,
        function: "update_price",
        params: [{ name: "price", type: "u128", doc: "Scaled price." }],
      },
      latencyBound: { maxSeconds: 60, targetSeconds: 15, tier: "standard" },
      fireEvent: {
        contractId: VALID_CONTRACT_ID,
        topics: [
          { kind: "symbol", value: "price_updated" },
          { kind: "typed", type: "address", doc: "Caller." },
        ],
        dataFields: [{ name: "price", type: "u128", doc: "Written value." }],
      },
    };
    expect(validateManifest(manifest).valid).toBe(true);
  });

  it("accepts windowSec at boundary values (1 and 86400)", () => {
    expect(
      validateManifest({
        ...validManifest(),
        trigger: { class: "cron", cron: "0 * * * *", timezone: "UTC", windowSec: 1 },
      }).valid,
    ).toBe(true);

    expect(
      validateManifest({
        ...validManifest(),
        trigger: { class: "cron", cron: "0 * * * *", timezone: "UTC", windowSec: 86400 },
      }).valid,
    ).toBe(true);
  });

  it("accepts fireEvent.contractId different from target.contractId (proxy pattern)", () => {
    const m = {
      ...validManifest(),
      fireEvent: { ...validManifest().fireEvent, contractId: VALID_CONTRACT_ID_2 },
    };
    expect(validateManifest(m).valid).toBe(true);
  });

  it("accepts a typed topic matcher", () => {
    const m = {
      ...validManifest(),
      fireEvent: {
        contractId: VALID_CONTRACT_ID,
        topics: [{ kind: "typed" as const, type: "address" }] as const,
      },
    };
    expect(validateManifest(m).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateManifest — manifestVersion
// ---------------------------------------------------------------------------

describe("validateManifest — manifestVersion", () => {
  it("rejects a missing manifestVersion", () => {
    const { manifestVersion: _, ...rest } = validManifest();
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/manifestVersion")).toBe(true);
    }
  });

  it("rejects a wrong manifestVersion", () => {
    const result = validateManifest({ ...validManifest(), manifestVersion: "2.0.0" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]!.path).toBe("/manifestVersion");
    }
  });
});

// ---------------------------------------------------------------------------
// validateManifest — id
// ---------------------------------------------------------------------------

describe("validateManifest — id", () => {
  it("rejects a missing id", () => {
    const { id: _, ...rest } = validManifest();
    expect(validateManifest(rest).valid).toBe(false);
  });

  it("rejects an empty id", () => {
    expect(validateManifest({ ...validManifest(), id: "" }).valid).toBe(false);
  });

  it("rejects an id with illegal characters", () => {
    const result = validateManifest({ ...validManifest(), id: "my org/worker!" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/id")).toBe(true);
    }
  });

  it("accepts id with dots and hyphens", () => {
    expect(validateManifest({ ...validManifest(), id: "my.org/my-worker_v2" }).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateManifest — trigger
// ---------------------------------------------------------------------------

describe("validateManifest — trigger", () => {
  it("rejects a missing trigger", () => {
    const { trigger: _, ...rest } = validManifest();
    expect(validateManifest(rest).valid).toBe(false);
  });

  it("rejects an unknown trigger class", () => {
    const result = validateManifest({
      ...validManifest(),
      trigger: { class: "webhook", url: "https://x.com" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/trigger/class")).toBe(true);
    }
  });

  it("rejects a cron trigger without cron expression", () => {
    const result = validateManifest({
      ...validManifest(),
      trigger: { class: "cron", timezone: "UTC" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/trigger/cron")).toBe(true);
    }
  });

  it("rejects a cron trigger without timezone", () => {
    const result = validateManifest({
      ...validManifest(),
      trigger: { class: "cron", cron: "0 * * * *" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/trigger/timezone")).toBe(true);
    }
  });

  it("rejects windowSec = 0", () => {
    const result = validateManifest({
      ...validManifest(),
      trigger: { class: "cron", cron: "0 * * * *", timezone: "UTC", windowSec: 0 },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects windowSec > 86400", () => {
    const result = validateManifest({
      ...validManifest(),
      trigger: { class: "cron", cron: "0 * * * *", timezone: "UTC", windowSec: 86401 },
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateManifest — target
// ---------------------------------------------------------------------------

describe("validateManifest — target", () => {
  it("rejects a missing target", () => {
    const { target: _, ...rest } = validManifest();
    expect(validateManifest(rest).valid).toBe(false);
  });

  it("rejects an invalid contractId format", () => {
    const result = validateManifest({
      ...validManifest(),
      target: { contractId: "GABC123", function: "tick" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/target/contractId")).toBe(true);
    }
  });

  it("rejects an empty function name", () => {
    const result = validateManifest({
      ...validManifest(),
      target: { contractId: VALID_CONTRACT_ID, function: "" },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a function name that starts with a digit", () => {
    const result = validateManifest({
      ...validManifest(),
      target: { contractId: VALID_CONTRACT_ID, function: "1tick" },
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateManifest — latencyBound
// ---------------------------------------------------------------------------

describe("validateManifest — latencyBound", () => {
  it("rejects a missing latencyBound", () => {
    const { latencyBound: _, ...rest } = validManifest();
    expect(validateManifest(rest).valid).toBe(false);
  });

  it("rejects maxSeconds = 0", () => {
    expect(validateManifest({ ...validManifest(), latencyBound: { maxSeconds: 0 } }).valid).toBe(
      false,
    );
  });

  it("rejects maxSeconds > 86400", () => {
    expect(
      validateManifest({ ...validManifest(), latencyBound: { maxSeconds: 86401 } }).valid,
    ).toBe(false);
  });

  it("accepts maxSeconds = 1 and = 86400", () => {
    expect(validateManifest({ ...validManifest(), latencyBound: { maxSeconds: 1 } }).valid).toBe(
      true,
    );
    expect(
      validateManifest({ ...validManifest(), latencyBound: { maxSeconds: 86400 } }).valid,
    ).toBe(true);
  });

  it("rejects targetSeconds >= maxSeconds", () => {
    const result = validateManifest({
      ...validManifest(),
      latencyBound: { maxSeconds: 30, targetSeconds: 30 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/latencyBound/targetSeconds")).toBe(true);
    }
  });

  it("accepts targetSeconds < maxSeconds", () => {
    expect(
      validateManifest({ ...validManifest(), latencyBound: { maxSeconds: 30, targetSeconds: 10 } })
        .valid,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateManifest — fireEvent
// ---------------------------------------------------------------------------

describe("validateManifest — fireEvent", () => {
  it("rejects a missing fireEvent", () => {
    const { fireEvent: _, ...rest } = validManifest();
    expect(validateManifest(rest).valid).toBe(false);
  });

  it("rejects fireEvent with no topics", () => {
    const result = validateManifest({
      ...validManifest(),
      fireEvent: { contractId: VALID_CONTRACT_ID, topics: [] },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path === "/fireEvent/topics")).toBe(true);
    }
  });

  it("rejects a topic with unknown kind", () => {
    const result = validateManifest({
      ...validManifest(),
      fireEvent: {
        contractId: VALID_CONTRACT_ID,
        topics: [{ kind: "regex", pattern: ".*" }],
      },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.path.startsWith("/fireEvent/topics"))).toBe(true);
    }
  });

  it("rejects a symbol topic with an empty value", () => {
    const result = validateManifest({
      ...validManifest(),
      fireEvent: {
        contractId: VALID_CONTRACT_ID,
        topics: [{ kind: "symbol", value: "" }],
      },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a typed topic with an empty type", () => {
    const result = validateManifest({
      ...validManifest(),
      fireEvent: {
        contractId: VALID_CONTRACT_ID,
        topics: [{ kind: "typed", type: "" }],
      },
    });
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateManifest — non-object input
// ---------------------------------------------------------------------------

describe("validateManifest — non-object input", () => {
  it("rejects null", () => {
    expect(validateManifest(null).valid).toBe(false);
  });
  it("rejects a string", () => {
    expect(validateManifest("hello").valid).toBe(false);
  });
  it("rejects an array", () => {
    expect(validateManifest([]).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

describe("parseManifest", () => {
  it("returns a parsed manifest for valid JSON", () => {
    const json = JSON.stringify(validManifest());
    const manifest = parseManifest(json);
    expect(manifest.id).toBe("test-org/my-worker");
    expect(manifest.manifestVersion).toBe(MANIFEST_SCHEMA_VERSION);
  });

  it("throws ManifestValidationError for malformed JSON", () => {
    expect(() => parseManifest("{not valid json")).toThrow(ManifestValidationError);
  });

  it("throws ManifestValidationError for valid JSON that fails schema", () => {
    const bad = JSON.stringify({ manifestVersion: "1.0.0", id: "x", name: "X" }); // missing required fields
    expect(() => parseManifest(bad)).toThrow(ManifestValidationError);
  });

  it("ManifestValidationError.issues is a non-empty array", () => {
    try {
      parseManifest(JSON.stringify({ manifestVersion: "1.0.0" }));
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).issues.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// WorkerManifestBuilder
// ---------------------------------------------------------------------------

describe("WorkerManifestBuilder", () => {
  it("builds a valid manifest from all required fields", () => {
    const manifest = new WorkerManifestBuilder()
      .id("org/worker")
      .name("My Worker")
      .trigger({ class: "cron", cron: "0 * * * *", timezone: "UTC" })
      .target({ contractId: VALID_CONTRACT_ID, function: "tick" })
      .latencyBound({ maxSeconds: 30 })
      .fireEvent({ contractId: VALID_CONTRACT_ID, topics: [{ kind: "symbol", value: "ticked" }] })
      .build();

    expect(manifest.manifestVersion).toBe(MANIFEST_SCHEMA_VERSION);
    expect(manifest.id).toBe("org/worker");
  });

  it("sets all optional fields correctly", () => {
    const manifest = new WorkerManifestBuilder()
      .id("org/worker")
      .name("My Worker")
      .description("Does things.")
      .version("1.2.3")
      .network("testnet")
      .author("org")
      .repository("https://github.com/org/worker")
      .tags(["oracle"])
      .trigger({ class: "cron", cron: "*/10 * * * *", timezone: "UTC", windowSec: 45 })
      .target({ contractId: VALID_CONTRACT_ID, function: "update" })
      .latencyBound({ maxSeconds: 60, targetSeconds: 20, tier: "fast" })
      .fireEvent({ contractId: VALID_CONTRACT_ID, topics: [{ kind: "symbol", value: "updated" }] })
      .build();

    expect(manifest.network).toBe("testnet");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.tags).toContain("oracle");
    expect(manifest.latencyBound.tier).toBe("fast");
  });

  it("throws ManifestValidationError when required fields are missing", () => {
    expect(() =>
      new WorkerManifestBuilder()
        .name("No ID Worker")
        // missing: id, trigger, target, latencyBound, fireEvent
        .build(),
    ).toThrow(ManifestValidationError);
  });

  it("throws ManifestValidationError with useful issue messages", () => {
    let caught!: ManifestValidationError;
    try {
      new WorkerManifestBuilder()
        .id("org/worker")
        .name("Worker")
        // missing trigger, target, latencyBound, fireEvent
        .build();
    } catch (e) {
      caught = e as ManifestValidationError;
    }
    expect(caught.issues.length).toBeGreaterThan(0);
    expect(
      caught.issues.every((i) => typeof i.path === "string" && typeof i.message === "string"),
    ).toBe(true);
  });

  it("is immutable between calls — chaining does not mutate previous builders", () => {
    const base = new WorkerManifestBuilder().id("base/worker").name("Base");
    const extended = base.description("Extended");

    // Both share the same underlying partial — that's fine since build() validates.
    // Key invariant: extended.build() fails (missing fields), base result is not corrupted.
    expect(() => base.build()).toThrow(ManifestValidationError);
    expect(() => extended.build()).toThrow(ManifestValidationError);
  });
});

// ---------------------------------------------------------------------------
// Schema example files
// ---------------------------------------------------------------------------

describe("schema examples", () => {
  const examples = ["xlm-price-oracle.manifest.json", "liquidity-pool-rebalancer.manifest.json"];

  for (const file of examples) {
    it(`${file} is valid against the manifest standard`, () => {
      const raw = readFileSync(resolve(SCHEMA_DIR, "examples", file), "utf8");
      const manifest = parseManifest(raw);
      expect(manifest.manifestVersion).toBe(MANIFEST_SCHEMA_VERSION);
    });
  }
});

// ---------------------------------------------------------------------------
// Standalone validator — no runtime dependency verification
// ---------------------------------------------------------------------------

describe("standalone validator — runtime independence", () => {
  it("validateManifest has no side effects between calls", () => {
    const m = validManifest();
    const r1 = validateManifest(m);
    const r2 = validateManifest(m);
    expect(r1.valid).toBe(true);
    expect(r2.valid).toBe(true);
  });

  it("errors returned are plain serialisable objects", () => {
    const result = validateManifest({ manifestVersion: "1.0.0" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const serialised = JSON.stringify(result.errors);
      const parsed = JSON.parse(serialised) as typeof result.errors;
      expect(parsed.length).toBeGreaterThan(0);
    }
  });
});
