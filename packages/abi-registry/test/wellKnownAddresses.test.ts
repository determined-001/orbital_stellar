/**
 * The bundled well-known specs name real mainnet contracts. Nothing verified
 * that until a publish transaction was already being built against the live
 * network: `aqua.json` carried a 56-character, C-prefixed string that was not
 * a valid contract address - the right shape with a bad checksum - and it
 * survived in the repository unnoticed because every check upstream of the
 * chain only looked at the schema.
 *
 * These are the four specs `scripts/seed-well-known.ts` publishes (issue
 * #890). A wrong address here files a spec on chain against a contract that
 * does not exist, under a `(contract_id, publisher, version)` key that is
 * immutable and cannot be corrected afterwards.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, Networks, StrKey } from "@stellar/stellar-sdk";

const WELL_KNOWN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../specs/well-known");

/** The four files the seeding script publishes. `sac-interface.json` is excluded there too. */
const SEEDED = ["usdc.json", "eurc.json", "aqua.json", "native-asset-wrapper.json"];

/**
 * Assets whose Stellar Asset Contract address is derivable from the asset
 * itself, so the stored value can be checked rather than merely trusted.
 */
const DERIVABLE: Record<string, Asset> = {
  "usdc.json": new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),
  "aqua.json": new Asset("AQUA", "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA"),
  "native-asset-wrapper.json": Asset.native(),
};

function contractIdOf(file: string): string {
  const raw = JSON.parse(readFileSync(resolve(WELL_KNOWN_DIR, file), "utf-8")) as {
    contract_id?: string;
  };
  expect(raw.contract_id, `${file} has no contract_id`).toBeTruthy();
  return raw.contract_id!;
}

describe("bundled well-known specs", () => {
  it.each(SEEDED)("%s names a structurally valid contract address", (file) => {
    // isValidContract checks the strkey checksum, which is what the length
    // and prefix alone do not.
    expect(StrKey.isValidContract(contractIdOf(file))).toBe(true);
  });

  it.each(Object.keys(DERIVABLE))("%s matches the SAC derived from its asset", (file) => {
    expect(contractIdOf(file)).toBe(DERIVABLE[file]!.contractId(Networks.PUBLIC));
  });

  it("names four distinct contracts", () => {
    const ids = SEEDED.map(contractIdOf);
    expect(new Set(ids).size).toBe(SEEDED.length);
  });
});
