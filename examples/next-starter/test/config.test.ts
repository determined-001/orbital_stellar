import { describe, expect, it } from "vitest";

import { loadConfig, StarterConfigError, isPlaceholderContractId } from "../lib/config";

/**
 * `loadConfig` is the reason this starter refuses to boot on bad input instead
 * of silently watching nothing, so the failure paths are the part worth
 * testing. Everything here is pure - no network, no filesystem.
 */

const VALID = "GCIX4IU5CLPZ5FFIZQ2NP54WUTXHIBLN6URD2LCRI4G5MB2EBKNV2BKZ";
const VALID_2 = "GAAGDYLQAJDE4PNSC72C43CKC74ARAWI5N4OJDNEXSP25UKLS37K6FCW";

describe("loadConfig", () => {
  it("parses a comma-separated address list and defaults to testnet", () => {
    const config = loadConfig({ STELLAR_ADDRESSES: `${VALID}, ${VALID_2}` });

    expect(config.addresses).toEqual([VALID, VALID_2]);
    expect(config.network).toBe("testnet");
    expect(config.sorobanRpcUrl).toBe("https://soroban-testnet.stellar.org");
  });

  it("selects mainnet and its RPC endpoint", () => {
    const config = loadConfig({
      STELLAR_ADDRESSES: VALID,
      NEXT_PUBLIC_STELLAR_NETWORK: "mainnet",
    });

    expect(config.network).toBe("mainnet");
    expect(config.sorobanRpcUrl).toBe("https://mainnet.sorobanrpc.com");
  });

  it("refuses to start with no addresses", () => {
    expect(() => loadConfig({})).toThrow(StarterConfigError);
    expect(() => loadConfig({ STELLAR_ADDRESSES: "  ,  " })).toThrow(/required/);
  });

  it("names the invalid key rather than failing later at subscribe time", () => {
    expect(() => loadConfig({ STELLAR_ADDRESSES: `${VALID},NOTAKEY` })).toThrow(
      /not a valid Stellar public key: NOTAKEY/,
    );
  });

  it("treats deploy-script placeholders as no contract at all", () => {
    // The manifest ships with these until deploy_testnet.sh has actually run;
    // accepting one would produce a page that looks live and never emits.
    for (const placeholder of ["<POPULATED BY deploy_testnet.sh>", "<unset>", "C"]) {
      expect(isPlaceholderContractId(placeholder)).toBe(true);
      expect(
        loadConfig({ STELLAR_ADDRESSES: VALID, DEMO_CONTRACT_ID: placeholder }).contractId,
      ).toBeNull();
    }
  });

  it("accepts a real contract id", () => {
    const contractId = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";
    expect(isPlaceholderContractId(contractId)).toBe(false);
    expect(loadConfig({ STELLAR_ADDRESSES: VALID, DEMO_CONTRACT_ID: contractId }).contractId).toBe(
      contractId,
    );
  });
});
