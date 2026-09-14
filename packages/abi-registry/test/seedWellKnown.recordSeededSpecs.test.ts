import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSeededSpecs } from "../scripts/seed-well-known.js";

const FIXTURE = {
  network: "testnet",
  deployerPublicKey: "GBBHYIMKT43UAFUG2F4QHSJK25Q2AZSA3RRB6JSHUABDAXMQARGJZYHG",
  deployedAt: "2026-09-06T13:46:57Z",
  contracts: {
    registry: {
      contractId: "CDJGK3KJMLQK6EVGOMIOQT35IFT2BTDVWC4ICEAXR7WBFTDGOP7FGXCV",
      wasmHash: "5c800423976a353fd06eb37f2d1c7fba63b3c15dc11fcfe90ec05787523d7662",
    },
    demoEmitter: {
      contractId: "CBGPM7FULEXM2WO4USIPC6XDJXKFUODU3EFAOVUZTJRAW4EJ2ZUA7PBJ",
      wasmHash: "d88550008695e6fe427d528064cc64f07436e74e7bc307364a4ef9e66bdb9a9b",
    },
  },
};

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "record-seeded-specs-"));
  path = join(dir, "deployed.testnet.json");
  writeFileSync(path, JSON.stringify(FIXTURE, null, 2) + "\n", "utf-8");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("recordSeededSpecs (issue #890)", () => {
  it("adds a seededSpecs entry per asset, keyed by contract_id", () => {
    recordSeededSpecs(
      [
        { contractId: "CUSDC", name: "USD Coin (USDC)", version: "1.0.0", specHash: "aaaa" },
        { contractId: "CEURC", name: "Euro Coin (EURC)", version: "1.0.0", specHash: "bbbb" },
      ],
      "GBBHYIMKT43UAFUG2F4QHSJK25Q2AZSA3RRB6JSHUABDAXMQARGJZYHG",
      path,
    );

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(written.contracts.registry.seededSpecs).toEqual({
      CUSDC: {
        name: "USD Coin (USDC)",
        version: "1.0.0",
        specHash: "aaaa",
        publisher: "GBBHYIMKT43UAFUG2F4QHSJK25Q2AZSA3RRB6JSHUABDAXMQARGJZYHG",
      },
      CEURC: {
        name: "Euro Coin (EURC)",
        version: "1.0.0",
        specHash: "bbbb",
        publisher: "GBBHYIMKT43UAFUG2F4QHSJK25Q2AZSA3RRB6JSHUABDAXMQARGJZYHG",
      },
    });
  });

  it("preserves the rest of the file untouched", () => {
    recordSeededSpecs(
      [{ contractId: "CUSDC", name: "USD Coin (USDC)", version: "1.0.0", specHash: "aaaa" }],
      "GBBHYIMKT43UAFUG2F4QHSJK25Q2AZSA3RRB6JSHUABDAXMQARGJZYHG",
      path,
    );

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(written.deployerPublicKey).toBe(FIXTURE.deployerPublicKey);
    expect(written.contracts.demoEmitter).toEqual(FIXTURE.contracts.demoEmitter);
    expect(written.contracts.registry.contractId).toBe(FIXTURE.contracts.registry.contractId);
  });

  it("merges into an existing seededSpecs map rather than replacing it", () => {
    recordSeededSpecs(
      [{ contractId: "CUSDC", name: "USD Coin (USDC)", version: "1.0.0", specHash: "aaaa" }],
      "GPUB",
      path,
    );
    recordSeededSpecs(
      [{ contractId: "CEURC", name: "Euro Coin (EURC)", version: "1.0.0", specHash: "bbbb" }],
      "GPUB",
      path,
    );

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(Object.keys(written.contracts.registry.seededSpecs).sort()).toEqual(["CEURC", "CUSDC"]);
  });

  it("overwrites a re-recorded asset's entry rather than duplicating it", () => {
    recordSeededSpecs(
      [{ contractId: "CUSDC", name: "USD Coin (USDC)", version: "1.0.0", specHash: "old-hash" }],
      "GPUB",
      path,
    );
    recordSeededSpecs(
      [{ contractId: "CUSDC", name: "USD Coin (USDC)", version: "1.0.0", specHash: "new-hash" }],
      "GPUB",
      path,
    );

    const written = JSON.parse(readFileSync(path, "utf-8"));
    expect(Object.keys(written.contracts.registry.seededSpecs)).toEqual(["CUSDC"]);
    expect(written.contracts.registry.seededSpecs.CUSDC.specHash).toBe("new-hash");
  });

  it("throws rather than writing when contracts.registry is missing", () => {
    writeFileSync(path, JSON.stringify({ contracts: {} }), "utf-8");
    expect(() =>
      recordSeededSpecs(
        [{ contractId: "CUSDC", name: "USD Coin (USDC)", version: "1.0.0", specHash: "aaaa" }],
        "GPUB",
        path,
      ),
    ).toThrow(/contracts.registry is missing/);
  });
});
