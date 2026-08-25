import { describe, it, expect, vi } from "vitest";
import { ChainedAbiRegistryClient } from "../src/ChainedAbiRegistryClient.js";
import type { AbiRegistryReader } from "../src/ChainedAbiRegistryClient.js";
import type { SpecSource, ContractSpec } from "../src/spec.js";

function client(getSpec: unknown, getSpecAt?: unknown): AbiRegistryReader {
  return {
    getSpec: vi.fn().mockResolvedValue(getSpec),
    ...(getSpecAt !== undefined ? { getSpecAt: vi.fn().mockResolvedValue(getSpecAt) } : {}),
  };
}

/** Helper: creates an AbiRegistryReader with a declared specSource. */
function sourcedClient(specSource: SpecSource, getSpec: unknown): AbiRegistryReader {
  return {
    getSpec: vi.fn().mockResolvedValue(getSpec),
    specSource,
  };
}

/** Minimal valid ContractSpec for test use. */
function fakeSpec(overrides?: Partial<ContractSpec>): ContractSpec {
  return {
    version: "1.0.0",
    name: "TestContract",
    functions: [],
    events: [],
    types: {},
    ...overrides,
  };
}

describe("ChainedAbiRegistryClient", () => {
  it("returns the first non-null result across clients", async () => {
    const a = client(null);
    const b = client({ name: "found in b" });
    const c = client({ name: "should not be reached" });
    const chained = new ChainedAbiRegistryClient([a, b, c]);

    expect(await chained.getSpec("C...")).toEqual({ name: "found in b" });
    expect(c.getSpec).not.toHaveBeenCalled();
  });

  it("returns null when every client misses", async () => {
    const chained = new ChainedAbiRegistryClient([client(null), client(null)]);
    expect(await chained.getSpec("C...")).toBeNull();
  });

  it("returns null with zero clients", async () => {
    const chained = new ChainedAbiRegistryClient([]);
    expect(await chained.getSpec("C...")).toBeNull();
  });

  it("getSpecAt falls back to getSpec for clients that don't implement getSpecAt", async () => {
    const a = client(null);
    const b = client({ name: "fallback via getSpec" }); // no getSpecAt
    const chained = new ChainedAbiRegistryClient([a, b]);

    expect(await chained.getSpecAt("C...", 100)).toEqual({ name: "fallback via getSpec" });
  });

  it("getSpecAt prefers a client's own getSpecAt when implemented", async () => {
    const a = client(null, { name: "from getSpecAt" });
    const chained = new ChainedAbiRegistryClient([a]);

    const result = await chained.getSpecAt("C...", 100);
    expect(result).toEqual({ name: "from getSpecAt" });
    expect(a.getSpecAt).toHaveBeenCalledWith("C...", 100);
  });
});

// ── Issue #903: getResolvedSpec - provenance tracking ─────────────────────────

describe("ChainedAbiRegistryClient.getResolvedSpec", () => {
  it("returns specSource from the winning client", async () => {
    const sep48 = sourcedClient("sep48", fakeSpec({ name: "from-sep48" }));
    const chained = new ChainedAbiRegistryClient([sep48]);

    const result = await chained.getResolvedSpec("C...");
    expect(result).not.toBeNull();
    expect(result!.specSource).toBe("sep48");
    expect(result!.spec.name).toBe("from-sep48");
  });

  it("returns null when every client misses", async () => {
    const chained = new ChainedAbiRegistryClient([
      sourcedClient("sep48", null),
      sourcedClient("registry", null),
    ]);
    expect(await chained.getResolvedSpec("C...")).toBeNull();
  });

  it("defaults specSource to 'discovery' when a client does not declare one", async () => {
    const untagged = client(fakeSpec({ name: "untagged" }));
    const chained = new ChainedAbiRegistryClient([untagged]);

    const result = await chained.getResolvedSpec("C...");
    expect(result!.specSource).toBe("discovery");
  });

  it("sep48 beats registry in precedence (first in chain wins)", async () => {
    const sep48 = sourcedClient("sep48", fakeSpec({ name: "embedded" }));
    const registry = sourcedClient("registry", fakeSpec({ name: "attested" }));
    const chained = new ChainedAbiRegistryClient([sep48, registry]);

    const result = await chained.getResolvedSpec("C...");
    expect(result!.specSource).toBe("sep48");
    expect(result!.spec.name).toBe("embedded");
  });

  it("falls through to registry when sep48 returns null", async () => {
    const sep48 = sourcedClient("sep48", null);
    const registry = sourcedClient("registry", fakeSpec({ name: "attested" }));
    const chained = new ChainedAbiRegistryClient([sep48, registry]);

    const result = await chained.getResolvedSpec("C...");
    expect(result!.specSource).toBe("registry");
    expect(result!.spec.name).toBe("attested");
  });

  it("falls through to wellKnown when both sep48 and registry miss", async () => {
    const sep48 = sourcedClient("sep48", null);
    const registry = sourcedClient("registry", null);
    const wellKnown = sourcedClient("wellKnown", fakeSpec({ name: "bundled" }));
    const chained = new ChainedAbiRegistryClient([sep48, registry, wellKnown]);

    const result = await chained.getResolvedSpec("C...");
    expect(result!.specSource).toBe("wellKnown");
    expect(result!.spec.name).toBe("bundled");
  });
});

// ── Issue #903: conflict warning when specs disagree ──────────────────────────

describe("ChainedAbiRegistryClient.getResolvedSpec - conflict warning", () => {
  it("emits a warning when sep48 and registry specs have different hashes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sep48Spec = fakeSpec({ name: "embedded", description: "sep48 version" });
    const registrySpec = fakeSpec({ name: "attested", description: "registry version" });

    const sep48 = sourcedClient("sep48", sep48Spec);
    const registry = sourcedClient("registry", registrySpec);
    const chained = new ChainedAbiRegistryClient([sep48, registry]);

    const result = await chained.getResolvedSpec("C...");

    // sep48 still wins
    expect(result!.specSource).toBe("sep48");

    // Warning was emitted with both sources named
    expect(warnSpy).toHaveBeenCalledOnce();
    const warning = warnSpy.mock.calls[0]![0] as string;
    expect(warning).toContain("[abi-registry]");
    expect(warning).toContain("sep48");
    expect(warning).toContain("registry");
    expect(warning).toContain("C...");

    warnSpy.mockRestore();
  });

  it("does NOT emit a warning when specs agree (same canonical hash)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sameSpec = fakeSpec({ name: "identical" });
    const sep48 = sourcedClient("sep48", sameSpec);
    const registry = sourcedClient("registry", sameSpec);
    const chained = new ChainedAbiRegistryClient([sep48, registry]);

    await chained.getResolvedSpec("C...");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does NOT emit a warning when only one client returns a result", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sep48 = sourcedClient("sep48", fakeSpec());
    const registry = sourcedClient("registry", null);
    const chained = new ChainedAbiRegistryClient([sep48, registry]);

    await chained.getResolvedSpec("C...");

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

/**
 * SEP-48's compatibility clause: an embedded event spec (discovered from the
 * contract's own `contractspecv0` WASM section - see `discoverContractSpec`)
 * is canonical when present. A registry attestation (`OnChainAbiRegistryClient`
 * or any other externally-published spec) only fills gaps for contracts with
 * no embedded spec - it never overrides one. These tests pin that ordering
 * for `ChainedAbiRegistryClient` so a future refactor can't silently invert
 * it: the embedded-spec reader must always be listed before the
 * registry-attestation reader when composing a SEP-48-compliant resolution
 * chain.
 *
 * An embedded-spec reader's `getSpec` must resolve to `null` for contracts
 * with no embedded spec, not throw `NoEmbeddedSpecError` - `discoverContractSpec`
 * throws that error directly, so any `AbiRegistryReader` wrapping it for use
 * in a chain is responsible for catching it and returning `null`, exactly
 * like the mock below.
 */
describe("ChainedAbiRegistryClient - SEP-48 embedded-spec vs. registry-attestation precedence", () => {
  const embeddedSpec = { source: "embedded", name: "canonical" };
  const registryAttestation = { source: "registry", name: "attestation" };

  it("prefers the embedded spec over a conflicting registry attestation", async () => {
    const embeddedSpecReader = client(embeddedSpec);
    const registryAttestationReader = client(registryAttestation);
    const chained = new ChainedAbiRegistryClient([embeddedSpecReader, registryAttestationReader]);

    expect(await chained.getSpec("C...")).toEqual(embeddedSpec);
    // The registry is never even consulted once the embedded spec resolves -
    // it doesn't just lose a conflict, it's not part of the decision at all.
    expect(registryAttestationReader.getSpec).not.toHaveBeenCalled();
  });

  it("falls through to the registry attestation when there is no embedded spec", async () => {
    const embeddedSpecReader = client(null); // no embedded contractspec section
    const registryAttestationReader = client(registryAttestation);
    const chained = new ChainedAbiRegistryClient([embeddedSpecReader, registryAttestationReader]);

    expect(await chained.getSpec("C...")).toEqual(registryAttestation);
  });

  it("reports unresolved when neither source has a spec, with no silent fallback", async () => {
    const embeddedSpecReader = client(null);
    const registryAttestationReader = client(null);
    const chained = new ChainedAbiRegistryClient([embeddedSpecReader, registryAttestationReader]);

    // A SEP-48 resolution chain deliberately excludes bundled/well-known
    // guesses - `null` here means genuinely unresolved, not "nothing bundled
    // matched either". Callers that want a bundled fallback must compose it
    // themselves, after the registry, and can no longer treat the result as
    // SEP-48-verified.
    expect(await chained.getSpec("C...")).toBeNull();
  });
});
