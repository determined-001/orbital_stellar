/**
 * Worker manifest standard — types, builder, and validator.
 *
 * ## What a manifest is
 *
 * A `worker.manifest.json` is a self-contained descriptor that any scheduler
 * implementation can emit and any consumer can process — including
 * implementations that never use `@orbital-stellar/worker-core`.  The format
 * is the durable asset; the package is optional tooling.
 *
 * ## The standard
 *
 * The canonical JSON Schema lives at:
 *   `packages/worker-core/schema/worker.manifest.json`
 *   $id: https://orbital-stellar.io/schema/worker.manifest.json
 *
 * That file is the source of truth.  The TypeScript types in this module are
 * derived from the schema and must remain in sync with it.
 *
 * ## Compatibility policy
 *
 * `manifestVersion` is currently `"1.0.0"`.
 * - **Patch** bumps (1.0.x): editorial only, no structural change.
 * - **Minor** bumps (1.x.0): new _optional_ fields added; all existing valid
 *   manifests remain valid.
 * - **Major** bumps (x.0.0): breaking change.  The schema $id changes.
 *   Old manifests do not validate against the new schema.
 *
 * Consumers MUST check `manifestVersion` before processing a manifest.
 *
 * ## Verification engine compatibility
 *
 * The verification engine (19.1) uses `fireEvent.contractId` and
 * `fireEvent.topics` to fetch the confirmation event from Stellar RPC and
 * score a worker.  It requires no operator cooperation beyond a valid manifest.
 * `latencyBound.maxSeconds` is the contractual definition of "on time".
 */

// ---------------------------------------------------------------------------
// Current schema version
// ---------------------------------------------------------------------------

export const MANIFEST_SCHEMA_VERSION = "1.0.0" as const;
export type ManifestSchemaVersion = typeof MANIFEST_SCHEMA_VERSION;

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

/** A time-based trigger driven by a cron schedule. */
export interface CronTrigger {
  readonly class: "cron";
  /** Standard five-field cron expression, e.g. `"0 * * * *"`. */
  readonly cron: string;
  /** IANA timezone name, e.g. `"UTC"` or `"America/New_York"`. */
  readonly timezone: string;
  /**
   * Width of the fire window in seconds (default: 60).
   * The scheduler must fire within this window starting at the cron moment.
   */
  readonly windowSec?: number;
}

/** Union of all trigger classes.  Only `"cron"` is defined in v1. */
export type TriggerSpec = CronTrigger;

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

export interface ParamSpec {
  readonly name: string;
  readonly type: string;
  readonly doc?: string;
}

/** The Soroban contract and function the worker invokes. */
export interface TargetSpec {
  /** Bech32 Soroban contract address (C…). */
  readonly contractId: string;
  /** Exported function name. */
  readonly function: string;
  /** Optional static parameter descriptors. */
  readonly params?: readonly ParamSpec[];
}

// ---------------------------------------------------------------------------
// Latency bound
// ---------------------------------------------------------------------------

/**
 * Contractual latency commitment.
 *
 * A worker is scored **late** by the verification engine when the confirmed
 * fire event's ledger timestamp exceeds `triggerTime + maxSeconds`.
 * This field makes W3 tier pricing expressible: tiers are latency SLAs.
 */
export interface LatencyBound {
  /**
   * Maximum seconds from trigger moment to on-chain confirmation.
   * Workers that land after this threshold are scored late.
   */
  readonly maxSeconds: number;
  /** Optional P50 target for dashboard reporting. Must be < `maxSeconds`. */
  readonly targetSeconds?: number;
  /**
   * Optional human-readable tier label (e.g. `"standard"`, `"fast"`).
   * Advisory only — scoring uses `maxSeconds`.
   */
  readonly tier?: string;
}

// ---------------------------------------------------------------------------
// Fire event
// ---------------------------------------------------------------------------

export type TopicMatcher =
  | { readonly kind: "symbol"; readonly value: string }
  | { readonly kind: "typed"; readonly type: string; readonly doc?: string };

export interface DataFieldSpec {
  readonly name: string;
  readonly type: string;
  readonly doc?: string;
}

/**
 * The on-chain Soroban event that confirms the worker fired successfully.
 * The verification engine fetches this event from Stellar RPC using
 * `contractId` and `topics` — with no operator cooperation required.
 */
export interface FireEventSpec {
  /** Contract that emits the confirmation event. Usually = `target.contractId`. */
  readonly contractId: string;
  /** Ordered topic matchers (at least one required). */
  readonly topics: readonly [TopicMatcher, ...TopicMatcher[]];
  /** Optional data field descriptors for scoring metadata extraction. */
  readonly dataFields?: readonly DataFieldSpec[];
}

// ---------------------------------------------------------------------------
// Top-level manifest
// ---------------------------------------------------------------------------

export interface WorkerManifest {
  readonly manifestVersion: ManifestSchemaVersion;
  /** Stable globally-unique worker identifier (e.g. `"my-org/oracle"`). */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly trigger: TriggerSpec;
  readonly target: TargetSpec;
  readonly latencyBound: LatencyBound;
  readonly fireEvent: FireEventSpec;
  readonly network?: "mainnet" | "testnet" | "futurenet";
  readonly author?: string;
  readonly repository?: string;
  readonly tags?: readonly string[];
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Fluent builder for `WorkerManifest` objects.
 *
 * ```ts
 * const manifest = new WorkerManifestBuilder()
 *   .id("my-org/xlm-oracle")
 *   .name("XLM Price Oracle")
 *   .trigger({ class: "cron", cron: "* * * * *", timezone: "UTC" })
 *   .target({ contractId: "C…", function: "update_price" })
 *   .latencyBound({ maxSeconds: 25 })
 *   .fireEvent({ contractId: "C…", topics: [{ kind: "symbol", value: "price_updated" }] })
 *   .build();
 * ```
 *
 * `build()` validates the resulting manifest and throws
 * `ManifestValidationError` if any required field is missing or invalid.
 */
export class WorkerManifestBuilder {
  #partial: Partial<WorkerManifest> = {
    manifestVersion: MANIFEST_SCHEMA_VERSION,
  };

  id(value: string): this {
    this.#partial = { ...this.#partial, id: value };
    return this;
  }

  name(value: string): this {
    this.#partial = { ...this.#partial, name: value };
    return this;
  }

  description(value: string): this {
    this.#partial = { ...this.#partial, description: value };
    return this;
  }

  version(value: string): this {
    this.#partial = { ...this.#partial, version: value };
    return this;
  }

  trigger(value: TriggerSpec): this {
    this.#partial = { ...this.#partial, trigger: value };
    return this;
  }

  target(value: TargetSpec): this {
    this.#partial = { ...this.#partial, target: value };
    return this;
  }

  latencyBound(value: LatencyBound): this {
    this.#partial = { ...this.#partial, latencyBound: value };
    return this;
  }

  fireEvent(value: FireEventSpec): this {
    this.#partial = { ...this.#partial, fireEvent: value };
    return this;
  }

  network(value: "mainnet" | "testnet" | "futurenet"): this {
    this.#partial = { ...this.#partial, network: value };
    return this;
  }

  author(value: string): this {
    this.#partial = { ...this.#partial, author: value };
    return this;
  }

  repository(value: string): this {
    this.#partial = { ...this.#partial, repository: value };
    return this;
  }

  tags(value: string[]): this {
    this.#partial = { ...this.#partial, tags: value };
    return this;
  }

  /**
   * Validates and returns the completed manifest.
   * @throws {ManifestValidationError} if validation fails.
   */
  build(): WorkerManifest {
    const result = validateManifest(this.#partial);
    if (!result.valid) {
      throw new ManifestValidationError(result.errors);
    }
    return this.#partial as WorkerManifest;
  }
}

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

export interface ManifestValidationIssue {
  /** JSON Pointer path to the offending field (e.g. `"/latencyBound/maxSeconds"`). */
  readonly path: string;
  readonly message: string;
}

/**
 * Thrown by `WorkerManifestBuilder.build()` and `parseManifest()` when a
 * manifest fails validation.
 */
export class ManifestValidationError extends Error {
  readonly name = "ManifestValidationError" as const;
  constructor(public readonly issues: readonly ManifestValidationIssue[]) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    super(`[worker-manifest] validation failed — ${summary}`);
  }
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors: readonly ManifestValidationIssue[] };

// ---------------------------------------------------------------------------
// Standalone validator
// ---------------------------------------------------------------------------

/**
 * Validates a manifest object (or any unknown value) against the worker
 * manifest standard.
 *
 * This function has **no dependency on `@orbital-stellar/worker-core`**
 * beyond this file — it uses pure TypeScript structural checks so it can be
 * copied into any project.  A compiled version is also exported as
 * `validateManifestJson` which accepts a raw JSON string.
 *
 * @returns `{ valid: true }` or `{ valid: false, errors }`.
 */
export function validateManifest(value: unknown): ValidationResult {
  const issues: ManifestValidationIssue[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      valid: false,
      errors: [{ path: "/", message: "must be a non-null object" }],
    };
  }

  const m = value as Record<string, unknown>;

  // ── manifestVersion ───────────────────────────────────────────────────────
  if (m["manifestVersion"] !== MANIFEST_SCHEMA_VERSION) {
    issues.push({
      path: "/manifestVersion",
      message: `must be "${MANIFEST_SCHEMA_VERSION}", got ${JSON.stringify(m["manifestVersion"])}`,
    });
  }

  // ── id ────────────────────────────────────────────────────────────────────
  if (typeof m["id"] !== "string" || m["id"].length === 0) {
    issues.push({ path: "/id", message: "required string, must not be empty" });
  } else if (!/^[a-zA-Z0-9_\-./]+$/.test(m["id"])) {
    issues.push({
      path: "/id",
      message: "must match pattern ^[a-zA-Z0-9_\\-./]+$",
    });
  }

  // ── name ──────────────────────────────────────────────────────────────────
  if (typeof m["name"] !== "string" || m["name"].length === 0) {
    issues.push({ path: "/name", message: "required string, must not be empty" });
  }

  // ── trigger ───────────────────────────────────────────────────────────────
  issues.push(...validateTrigger(m["trigger"]));

  // ── target ────────────────────────────────────────────────────────────────
  issues.push(...validateTarget(m["target"]));

  // ── latencyBound ──────────────────────────────────────────────────────────
  issues.push(...validateLatencyBound(m["latencyBound"]));

  // ── fireEvent ─────────────────────────────────────────────────────────────
  issues.push(...validateFireEvent(m["fireEvent"]));

  return issues.length === 0 ? { valid: true } : { valid: false, errors: issues };
}

/**
 * Parses and validates a raw JSON string.
 *
 * @throws {ManifestValidationError} if the JSON is invalid or the manifest
 *   does not conform to the schema.
 */
export function parseManifest(json: string): WorkerManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ManifestValidationError([
      { path: "/", message: `JSON parse error: ${(err as Error).message}` },
    ]);
  }
  const result = validateManifest(parsed);
  if (!result.valid) {
    throw new ManifestValidationError(result.errors);
  }
  return parsed as WorkerManifest;
}

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

function validateTrigger(trigger: unknown): ManifestValidationIssue[] {
  if (typeof trigger !== "object" || trigger === null) {
    return [{ path: "/trigger", message: "required object" }];
  }
  const t = trigger as Record<string, unknown>;
  const issues: ManifestValidationIssue[] = [];

  if (t["class"] !== "cron") {
    issues.push({
      path: "/trigger/class",
      message: `must be "cron" (only cron triggers are defined in v1), got ${JSON.stringify(t["class"])}`,
    });
    return issues; // can't validate further without knowing the class
  }

  if (typeof t["cron"] !== "string" || t["cron"].length < 9) {
    issues.push({
      path: "/trigger/cron",
      message: "required string cron expression (minimum 9 characters)",
    });
  }
  if (typeof t["timezone"] !== "string" || t["timezone"].length === 0) {
    issues.push({ path: "/trigger/timezone", message: "required non-empty string" });
  }
  if (t["windowSec"] !== undefined) {
    if (
      typeof t["windowSec"] !== "number" ||
      !Number.isInteger(t["windowSec"]) ||
      t["windowSec"] < 1 ||
      t["windowSec"] > 86400
    ) {
      issues.push({
        path: "/trigger/windowSec",
        message: "must be an integer between 1 and 86400",
      });
    }
  }

  return issues;
}

function validateTarget(target: unknown): ManifestValidationIssue[] {
  if (typeof target !== "object" || target === null) {
    return [{ path: "/target", message: "required object" }];
  }
  const t = target as Record<string, unknown>;
  const issues: ManifestValidationIssue[] = [];

  if (typeof t["contractId"] !== "string" || !/^C[A-Z2-7]{55}$/.test(t["contractId"])) {
    issues.push({
      path: "/target/contractId",
      message: "must be a valid Soroban contract address (C followed by 55 base32 characters)",
    });
  }
  if (typeof t["function"] !== "string" || t["function"].length === 0) {
    issues.push({ path: "/target/function", message: "required non-empty string" });
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t["function"])) {
    issues.push({
      path: "/target/function",
      message: "must be a valid identifier (^[a-zA-Z_][a-zA-Z0-9_]*$)",
    });
  }

  return issues;
}

function validateLatencyBound(lb: unknown): ManifestValidationIssue[] {
  if (typeof lb !== "object" || lb === null) {
    return [{ path: "/latencyBound", message: "required object" }];
  }
  const l = lb as Record<string, unknown>;
  const issues: ManifestValidationIssue[] = [];

  if (
    typeof l["maxSeconds"] !== "number" ||
    !Number.isInteger(l["maxSeconds"]) ||
    l["maxSeconds"] < 1 ||
    l["maxSeconds"] > 86400
  ) {
    issues.push({
      path: "/latencyBound/maxSeconds",
      message: "required integer between 1 and 86400",
    });
  } else if (
    l["targetSeconds"] !== undefined &&
    (typeof l["targetSeconds"] !== "number" ||
      !Number.isInteger(l["targetSeconds"]) ||
      l["targetSeconds"] < 1 ||
      (l["targetSeconds"] as number) >= (l["maxSeconds"] as number))
  ) {
    issues.push({
      path: "/latencyBound/targetSeconds",
      message: "must be a positive integer less than maxSeconds",
    });
  }

  return issues;
}

function validateFireEvent(fe: unknown): ManifestValidationIssue[] {
  if (typeof fe !== "object" || fe === null) {
    return [{ path: "/fireEvent", message: "required object" }];
  }
  const f = fe as Record<string, unknown>;
  const issues: ManifestValidationIssue[] = [];

  if (typeof f["contractId"] !== "string" || !/^C[A-Z2-7]{55}$/.test(f["contractId"])) {
    issues.push({
      path: "/fireEvent/contractId",
      message: "must be a valid Soroban contract address",
    });
  }

  if (!Array.isArray(f["topics"]) || f["topics"].length === 0) {
    issues.push({
      path: "/fireEvent/topics",
      message: "required non-empty array of topic matchers",
    });
  } else {
    for (let i = 0; i < f["topics"].length; i++) {
      const topic = f["topics"][i] as Record<string, unknown>;
      if (typeof topic !== "object" || topic === null) {
        issues.push({ path: `/fireEvent/topics/${i}`, message: "must be an object" });
        continue;
      }
      if (topic["kind"] === "symbol") {
        if (typeof topic["value"] !== "string" || topic["value"].length === 0) {
          issues.push({
            path: `/fireEvent/topics/${i}/value`,
            message: 'required non-empty string for kind "symbol"',
          });
        }
      } else if (topic["kind"] === "typed") {
        if (typeof topic["type"] !== "string" || topic["type"].length === 0) {
          issues.push({
            path: `/fireEvent/topics/${i}/type`,
            message: 'required non-empty string for kind "typed"',
          });
        }
      } else {
        issues.push({
          path: `/fireEvent/topics/${i}/kind`,
          message: 'must be "symbol" or "typed"',
        });
      }
    }
  }

  return issues;
}
