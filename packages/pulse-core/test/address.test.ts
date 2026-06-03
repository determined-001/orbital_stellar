/**
 * address.ts — branded address type tests
 *
 * Covers:
 *  - Runtime predicate correctness (is* guards)
 *  - Unsafe cast helpers (to*)
 *  - Compile-time narrowing verified via exhaustive switch over NormalizedEvent
 */
import { describe, it, expect } from "vitest";
import {
  isAccountAddress,
  isMuxedAddress,
  isContractAddress,
  isStellarAddress,
  toAccountAddress,
  toMuxedAddress,
  toContractAddress,
} from "../src/address.js";
import type {
  AccountAddress,
  ContractAddress,
  MuxedAddress,
  StellarAddress,
} from "../src/address.js";
import type { NormalizedEvent } from "../src/index.js";

// ---------------------------------------------------------------------------
// Representative valid addresses (real StrKey-encoded values)
// ---------------------------------------------------------------------------

// Ed25519 public key — starts with G
const VALID_ACCOUNT =
  "GBAZF32CQRU6NZKSOLNAM6F7UR2WAVTE2JEYINXJNAKU6673OBGICC2P";

// Muxed account — starts with M
const VALID_MUXED =
  "MAAAAAABAAAAAACBSLXUFBDJ43SVE4W2AZ4L7JDVMBLGJUSJQQ3OS2AVJ557W4CMQFRN2";

// Soroban contract — starts with C
const VALID_CONTRACT =
  "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";

// ---------------------------------------------------------------------------
// isAccountAddress
// ---------------------------------------------------------------------------

describe("isAccountAddress", () => {
  it("returns true for a valid Ed25519 public key", () => {
    expect(isAccountAddress(VALID_ACCOUNT)).toBe(true);
  });

  it("returns false for a muxed address", () => {
    expect(isAccountAddress(VALID_MUXED)).toBe(false);
  });

  it("returns false for a contract address", () => {
    expect(isAccountAddress(VALID_CONTRACT)).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAccountAddress("")).toBe(false);
  });

  it("returns false for arbitrary garbage", () => {
    expect(isAccountAddress("not-an-address")).toBe(false);
  });

  it("narrows the type to AccountAddress", () => {
    const s: string = VALID_ACCOUNT;
    if (isAccountAddress(s)) {
      // TypeScript should accept this assignment without error
      const _: AccountAddress = s;
      expect(_).toBe(VALID_ACCOUNT);
    } else {
      throw new Error("Expected isAccountAddress to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isMuxedAddress
// ---------------------------------------------------------------------------

describe("isMuxedAddress", () => {
  it("returns true for a valid muxed address", () => {
    expect(isMuxedAddress(VALID_MUXED)).toBe(true);
  });

  it("returns false for a plain account address", () => {
    expect(isMuxedAddress(VALID_ACCOUNT)).toBe(false);
  });

  it("returns false for a contract address", () => {
    expect(isMuxedAddress(VALID_CONTRACT)).toBe(false);
  });

  it("narrows the type to MuxedAddress", () => {
    const s: string = VALID_MUXED;
    if (isMuxedAddress(s)) {
      const _: MuxedAddress = s;
      expect(_).toBe(VALID_MUXED);
    } else {
      throw new Error("Expected isMuxedAddress to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isContractAddress
// ---------------------------------------------------------------------------

describe("isContractAddress", () => {
  it("returns true for a valid contract address", () => {
    expect(isContractAddress(VALID_CONTRACT)).toBe(true);
  });

  it("returns false for an account address", () => {
    expect(isContractAddress(VALID_ACCOUNT)).toBe(false);
  });

  it("returns false for a muxed address", () => {
    expect(isContractAddress(VALID_MUXED)).toBe(false);
  });

  it("narrows the type to ContractAddress", () => {
    const s: string = VALID_CONTRACT;
    if (isContractAddress(s)) {
      const _: ContractAddress = s;
      expect(_).toBe(VALID_CONTRACT);
    } else {
      throw new Error("Expected isContractAddress to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// isStellarAddress
// ---------------------------------------------------------------------------

describe("isStellarAddress", () => {
  it("returns true for an account address", () => {
    expect(isStellarAddress(VALID_ACCOUNT)).toBe(true);
  });

  it("returns true for a muxed address", () => {
    expect(isStellarAddress(VALID_MUXED)).toBe(true);
  });

  it("returns true for a contract address", () => {
    expect(isStellarAddress(VALID_CONTRACT)).toBe(true);
  });

  it("returns false for garbage", () => {
    expect(isStellarAddress("XNOTVALID")).toBe(false);
  });

  it("narrows the type to StellarAddress", () => {
    const s: string = VALID_ACCOUNT;
    if (isStellarAddress(s)) {
      const _: StellarAddress = s;
      expect(_).toBe(VALID_ACCOUNT);
    } else {
      throw new Error("Expected isStellarAddress to return true");
    }
  });
});

// ---------------------------------------------------------------------------
// Unsafe cast helpers
// ---------------------------------------------------------------------------

describe("toAccountAddress", () => {
  it("returns the same string value", () => {
    expect(toAccountAddress(VALID_ACCOUNT)).toBe(VALID_ACCOUNT);
  });

  it("produces an AccountAddress-typed value", () => {
    const addr: AccountAddress = toAccountAddress(VALID_ACCOUNT);
    expect(addr).toBe(VALID_ACCOUNT);
  });
});

describe("toMuxedAddress", () => {
  it("returns the same string value", () => {
    expect(toMuxedAddress(VALID_MUXED)).toBe(VALID_MUXED);
  });

  it("produces a MuxedAddress-typed value", () => {
    const addr: MuxedAddress = toMuxedAddress(VALID_MUXED);
    expect(addr).toBe(VALID_MUXED);
  });
});

describe("toContractAddress", () => {
  it("returns the same string value", () => {
    expect(toContractAddress(VALID_CONTRACT)).toBe(VALID_CONTRACT);
  });

  it("produces a ContractAddress-typed value", () => {
    const addr: ContractAddress = toContractAddress(VALID_CONTRACT);
    expect(addr).toBe(VALID_CONTRACT);
  });
});

// ---------------------------------------------------------------------------
// Exhaustive switch over NormalizedEvent — compile-time narrowing proof
//
// This function must compile without error.  If any event branch is missing,
// TypeScript will report an error on the `_exhaustive` assignment.
// If any address field is typed as plain `string` instead of a branded type,
// the explicit typed assignments inside each branch will fail to compile.
// ---------------------------------------------------------------------------

function assertNarrowedAddresses(event: NormalizedEvent): string {
  switch (event.type) {
    case "payment.received":
    case "payment.sent":
    case "payment.self": {
      const to: AccountAddress | MuxedAddress = event.to;
      const from: AccountAddress | MuxedAddress = event.from;
      return `${to}->${from}`;
    }

    case "account.options_changed": {
      const source: AccountAddress = event.source;
      return source;
    }

    case "account.created": {
      const funder: AccountAddress = event.funder;
      const account: AccountAddress = event.account;
      return `${funder}:${account}`;
    }

    case "trustline.added":
    case "trustline.removed":
    case "trustline.updated": {
      const account: AccountAddress = event.account;
      return account;
    }

    case "account.merged": {
      const source: AccountAddress = event.source;
      const destination: AccountAddress = event.destination;
      return `${source}->${destination}`;
    }

    case "offer.created":
    case "offer.updated":
    case "offer.deleted": {
      const source: AccountAddress = event.source;
      return source;
    }

    case "account.bump_sequence": {
      const source: AccountAddress = event.source;
      return source;
    }

    case "data.set":
    case "data.cleared": {
      const source: AccountAddress = event.source;
      return source;
    }

    case "claimable.created": {
      const sponsor: AccountAddress = event.sponsor;
      const dest: AccountAddress = event.claimants[0]?.destination ?? toAccountAddress("");
      return `${sponsor}:${dest}`;
    }

    case "claimable.claimed": {
      const claimant: AccountAddress = event.claimant;
      return claimant;
    }

    case "lp.deposited":
    case "lp.withdrawn": {
      const source: AccountAddress = event.source;
      return source;
    }

    case "trustline.authorized":
    case "trustline.deauthorized": {
      const trustor: AccountAddress = event.trustor;
      const issuer: AccountAddress = event.issuer;
      return `${trustor}:${issuer}`;
    }

    case "contract.invoked": {
      const contractId: ContractAddress = event.contractId;
      return contractId;
    }

    case "contract.emitted": {
      const contractId: ContractAddress = event.contractId;
      return contractId;
    }

    default: {
      // Exhaustiveness check — TypeScript errors here if a case is missing
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

describe("NormalizedEvent exhaustive switch — address narrowing", () => {
  it("compiles and narrows payment addresses to AccountAddress | MuxedAddress", () => {
    const event: NormalizedEvent = {
      type: "payment.received",
      to: toAccountAddress(VALID_ACCOUNT),
      from: toAccountAddress(VALID_ACCOUNT),
      amount: "100",
      asset: "XLM",
      timestamp: "2026-01-01T00:00:00Z",
      raw: null,
    };
    expect(assertNarrowedAddresses(event)).toContain(VALID_ACCOUNT);
  });

  it("compiles and narrows contract addresses to ContractAddress", () => {
    const event: NormalizedEvent = {
      type: "contract.emitted",
      contractId: toContractAddress(VALID_CONTRACT),
      topics: [],
      data: null,
      timestamp: "2026-01-01T00:00:00Z",
      raw: null,
    };
    expect(assertNarrowedAddresses(event)).toBe(VALID_CONTRACT);
  });

  it("compiles and narrows account.created funder and account fields", () => {
    const event: NormalizedEvent = {
      type: "account.created",
      funder: toAccountAddress(VALID_ACCOUNT),
      account: toAccountAddress(VALID_ACCOUNT),
      starting_balance: "10",
      timestamp: "2026-01-01T00:00:00Z",
      raw: null,
    };
    expect(assertNarrowedAddresses(event)).toContain(VALID_ACCOUNT);
  });

  it("compiles and narrows trustline.authorized trustor and issuer fields", () => {
    const event: NormalizedEvent = {
      type: "trustline.authorized",
      trustor: toAccountAddress(VALID_ACCOUNT),
      issuer: toAccountAddress(VALID_ACCOUNT),
      asset: "USDC:GISSUER",
      timestamp: "2026-01-01T00:00:00Z",
      operation: "allow_trust",
      raw: null,
    };
    expect(assertNarrowedAddresses(event)).toContain(VALID_ACCOUNT);
  });
});
