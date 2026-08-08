import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRestrictedSecretNetwork } from "@orbital-stellar/pulse-core";
import { isDemoEmitterConfigured } from "@/lib/fireDemoEvent";

const VARS = ["DEMO_EMITTER_CONTRACT_ID", "DEMO_EMITTER_SECRET"] as const;
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
    // contracts/deployed.testnet.json ships with placeholder IDs until
    // contracts/deploy/deploy_testnet.sh is run. Reporting `configured: true`
    // here would leave the UI offering a button that cannot work.
    expect(isDemoEmitterConfigured()).toBe(false);
  });

  it("stays NOT configured when a contract ID is set but no secret is", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID =
      "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
    expect(isDemoEmitterConfigured()).toBe(false);
  });

  it("rejects the deploy script's placeholder as if it were unset", () => {
    process.env.DEMO_EMITTER_CONTRACT_ID = "<POPULATED BY deploy_testnet.sh>";
    process.env.DEMO_EMITTER_SECRET = "SDEMO";
    expect(isDemoEmitterConfigured()).toBe(false);
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
