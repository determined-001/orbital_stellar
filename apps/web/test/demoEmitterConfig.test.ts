import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";

// `resolveDemoEmitterContractId` falls back to contracts/deployed.testnet.json
// when the env var is absent or a placeholder. That manifest holds real IDs
// since the 2026-08-11 testnet deployment, so tests asserting the env-var rules
// must isolate themselves from it - otherwise they assert the deployment state
// rather than the rule they name.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  };
});

/** Runs `fn` as if the deployment manifest were absent (pre-deployment state). */
function withoutDeploymentManifest<T>(fn: () => T): T {
  vi.mocked(existsSync).mockReturnValueOnce(false);
  return fn();
}
import { resolve } from "node:path";
import { assertRestrictedSecretNetwork } from "@orbital-stellar/pulse-core";
import { isDemoEmitterConfigured, getDemoEmitterConfig } from "@/lib/fireDemoEvent";

const VARS = ["DEMO_EMITTER_CONTRACT_ID", "DEMO_EMITTER_SECRET", "VERCEL_ENV"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("isDemoEmitterConfigured", () => {
  it("reports NOT configured when the contract has not been deployed", () => {
    // Before deployment there is no manifest to fall back to. Reporting
    // `configured: true` here would leave the UI offering a button that
    // cannot work.
    expect(withoutDeploymentManifest(() => isDemoEmitterConfigured())).toBe(false);
  });

  it("stays NOT configured when a contract ID is set but no secret is", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID =
      "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
    expect(isDemoEmitterConfigured()).toBe(false);
  });

  it("rejects the deploy script's placeholder as if it were unset", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID = "<POPULATED BY deploy_testnet.sh>";
    process.env.DEMO_EMITTER_SECRET = "SDEMO";
    expect(withoutDeploymentManifest(() => isDemoEmitterConfigured())).toBe(false);
  });

  it("falls back to the deployment manifest when the env var is a placeholder", () => {
    // Post-deployment, a placeholder env var is not fatal - resolution falls
    // through to the committed manifest, which carries the real contract ID.
    process.env.DEMO_EMITTER_CONTRACT_ID = "<POPULATED BY deploy_testnet.sh>";
    process.env.DEMO_EMITTER_SECRET = "SDEMOSECRET";
    expect(isDemoEmitterConfigured()).toBe(true);
  });

  it("reports configured only with a real contract ID and a secret", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID =
      "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
    process.env.DEMO_EMITTER_SECRET = "SDEMOSECRET";
    expect(isDemoEmitterConfigured()).toBe(true);
  });
});

describe("contracts/deployed.testnet.json", () => {
  it("is either fully placeholder or fully populated, never half-wired", () => {
    // A manifest with a real registry ID but a placeholder demoEmitter (or the
    // reverse) is the state that produces a half-live demo.
    const manifest = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "..", "..", "contracts", "deployed.testnet.json"),
        "utf-8",
      ),
    ) as { contracts: Record<string, { contractId: string }> };

    const ids = Object.values(manifest.contracts).map((c) => c.contractId);
    const placeholders = ids.filter((id) => id.startsWith("<") || id.includes("POPULATED BY"));
    expect(placeholders.length === 0 || placeholders.length === ids.length).toBe(true);
  });
});

describe("assertRestrictedSecretNetwork", () => {
  it("permits the testnet passphrase", () => {
    expect(() =>
      assertRestrictedSecretNetwork({
        secretName: "DEMO_EMITTER_SECRET",
        networkPassphrase: "Test SDF Network ; September 2015",
        context: "demo",
      }),
    ).not.toThrow();
  });

  it("refuses to sign when the demo path is pointed at mainnet", () => {
    // The fire-event button is anonymous and unauthenticated. If this
    // deployment is ever configured for mainnet, refusing is the only
    // acceptable behaviour - a stranger's click must not move real value.
    expect(() =>
      assertRestrictedSecretNetwork({
        secretName: "DEMO_EMITTER_SECRET",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
        context: "demo",
      }),
    ).toThrow();
  });
});

describe("getDemoEmitterConfig", () => {
  const REAL_ID = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

  // `mockReset` restores the implementation `vi.fn(actual.readFileSync)` was
  // created with, so the real reader is back for the next test.
  beforeEach(() => {
    vi.mocked(readFileSync).mockClear();
  });

  afterEach(() => {
    vi.mocked(readFileSync).mockReset();
  });

  it("requires DEMO_EMITTER_CONTRACT_ID in production instead of reading the manifest", () => {
    // The manifest lives outside apps/web and is never traced into the
    // serverless bundle, so trusting it in production is works-on-my-machine.
    process.env.VERCEL_ENV = "production";
    process.env.DEMO_EMITTER_SECRET = "SDEMOSECRET";

    const config = getDemoEmitterConfig();

    expect(config.configured).toBe(false);
    expect(config.status).toBe("unconfigured");
    expect(config.reason).toMatch(/required in production/i);
    expect(vi.mocked(readFileSync)).not.toHaveBeenCalled();
  });

  it("reports `unreadable`, not `unconfigured`, when the manifest cannot be parsed", () => {
    // The two are diagnosed differently: one is a deliberate off switch, the
    // other is a broken deployment that used to fail silently (#1030).
    process.env.DEMO_EMITTER_SECRET = "SDEMOSECRET";
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error("EACCES");
    });

    const config = getDemoEmitterConfig();

    expect(config.configured).toBe(false);
    expect(config.status).toBe("unreadable");
  });

  it("reports `unconfigured` when the contract ID resolves but the secret does not", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID = REAL_ID;

    const config = getDemoEmitterConfig();

    expect(config.configured).toBe(false);
    expect(config.status).toBe("unconfigured");
    expect(config.reason).toMatch(/DEMO_EMITTER_SECRET/);
  });

  it("reports ok when both the contract ID and the secret are set", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID = REAL_ID;
    process.env.DEMO_EMITTER_SECRET = "SDEMOSECRET";

    expect(getDemoEmitterConfig()).toEqual({ configured: true, status: "ok" });
  });
});
