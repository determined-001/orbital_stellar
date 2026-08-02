import { describe, expect, it } from "vitest";
import {
  assertRestrictedSecretNetwork,
  isCiEnvironment,
  redactSecret,
  MainnetSecretInRestrictedPathError,
  NETWORK_PASSPHRASES,
} from "../src/index.js";

describe("restricted-path secret policy (#926)", () => {
  it("refuses a demo signing key pointed at mainnet", () => {
    expect(() =>
      assertRestrictedSecretNetwork({
        secretName: "DEMO_EMITTER_SECRET",
        networkPassphrase: NETWORK_PASSPHRASES.mainnet,
        context: "demo",
      }),
    ).toThrow(MainnetSecretInRestrictedPathError);
  });

  it("refuses a CI signing key pointed at mainnet", () => {
    expect(() =>
      assertRestrictedSecretNetwork({
        secretName: "SOROBAN_INVOKER_SECRET",
        networkPassphrase: NETWORK_PASSPHRASES.mainnet,
        context: "ci",
      }),
    ).toThrow(/testnet-only/);
  });

  it("names the offending variable and context in the error", () => {
    try {
      assertRestrictedSecretNetwork({
        secretName: "DEMO_EMITTER_SECRET",
        networkPassphrase: NETWORK_PASSPHRASES.mainnet,
        context: "demo",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(MainnetSecretInRestrictedPathError);
      const typed = error as MainnetSecretInRestrictedPathError;
      expect(typed.secretName).toBe("DEMO_EMITTER_SECRET");
      expect(typed.context).toBe("demo");
      // The message must never carry the secret itself.
      expect(typed.message).not.toMatch(/S[A-Z2-7]{55}/);
    }
  });

  it("allows testnet in both restricted contexts", () => {
    for (const context of ["demo", "ci"] as const) {
      expect(() =>
        assertRestrictedSecretNetwork({
          secretName: "DEMO_EMITTER_SECRET",
          networkPassphrase: NETWORK_PASSPHRASES.testnet,
          context,
        }),
      ).not.toThrow();
    }
  });

  it("detects a CI runner from the usual variables", () => {
    expect(isCiEnvironment({ CI: "true" })).toBe(true);
    expect(isCiEnvironment({ CI: "1" })).toBe(true);
    expect(isCiEnvironment({ GITHUB_ACTIONS: "true" })).toBe(true);
    expect(isCiEnvironment({})).toBe(false);
    expect(isCiEnvironment({ CI: "false" })).toBe(false);
  });
});

describe("redactSecret", () => {
  it("keeps a correlatable prefix but never enough to use", () => {
    const secret = "SDEMOSECRETVALUE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ01";
    const redacted = redactSecret(secret);

    expect(redacted).toContain("SDEM");
    expect(redacted).not.toContain(secret);
    expect(redacted).not.toContain(secret.slice(4, 40));
  });

  it("redacts short values whole - too small to reveal safely", () => {
    expect(redactSecret("short")).toBe("<redacted>");
  });

  it("reports an unset secret distinctly from a redacted one", () => {
    expect(redactSecret(undefined)).toBe("<unset>");
    expect(redactSecret("")).toBe("<unset>");
  });
});
