import { describe, expect, it } from "vitest";
import { xdr, Address } from "@stellar/stellar-sdk";
import { scvalToJs, jsToScval } from "../src/scval.js";

describe("Soroban ScVal typed helpers", () => {
  // Helper to assert perfect XDR round-tripping
  function assertRoundTrip(original: xdr.ScVal, spec?: any, checkInference = true) {
    const jsVal = scvalToJs(original);
    const roundTripped = jsToScval(jsVal, spec);

    expect(
      roundTripped.toXDR().equals(original.toXDR()),
      `Failed round-trip with spec for ${original.switch().name}`,
    ).toBe(true);

    if (checkInference) {
      const inferred = jsToScval(jsVal);
      expect(
        inferred.toXDR().equals(original.toXDR()),
        `Failed round-trip with inferred spec for ${original.switch().name}`,
      ).toBe(true);
    }
  }

  describe("Primitives & Numeric Types", () => {
    it("handles Void", () => {
      const original = xdr.ScVal.scvVoid();
      assertRoundTrip(original, "void");
    });

    it("handles Bool", () => {
      assertRoundTrip(xdr.ScVal.scvBool(true), "bool");
      assertRoundTrip(xdr.ScVal.scvBool(false), "bool");
    });

    it("handles U32", () => {
      assertRoundTrip(xdr.ScVal.scvU32(0), "u32", false);
      assertRoundTrip(xdr.ScVal.scvU32(4294967295), "u32", false);
    });

    it("handles I32", () => {
      assertRoundTrip(xdr.ScVal.scvI32(0), "i32");
      assertRoundTrip(xdr.ScVal.scvI32(-2147483648), "i32");
      assertRoundTrip(xdr.ScVal.scvI32(2147483647), "i32");
    });

    it("handles U64", () => {
      assertRoundTrip(xdr.ScVal.scvU64(new xdr.Uint64(0n)), "u64");
      assertRoundTrip(xdr.ScVal.scvU64(new xdr.Uint64(18446744073709551615n)), "u64");
    });

    it("handles I64", () => {
      assertRoundTrip(xdr.ScVal.scvI64(new xdr.Int64(0n)), "i64", false);
      assertRoundTrip(xdr.ScVal.scvI64(new xdr.Int64(-9223372036854775808n)), "i64", false);
      assertRoundTrip(xdr.ScVal.scvI64(new xdr.Int64(9223372036854775807n)), "i64", false);
    });

    it("handles Timepoint", () => {
      assertRoundTrip(xdr.ScVal.scvTimepoint(new xdr.Uint64(123456n)), "timepoint", false);
    });

    it("handles Duration", () => {
      assertRoundTrip(xdr.ScVal.scvDuration(new xdr.Uint64(999999n)), "duration", false);
    });
  });

  describe("Large Integers (128-bit & 256-bit)", () => {
    it("handles U128", () => {
      const parts = new xdr.UInt128Parts({
        hi: new xdr.Uint64(12345n),
        lo: new xdr.Uint64(67890n),
      });
      assertRoundTrip(xdr.ScVal.scvU128(parts), "u128", true);
    });

    it("handles I128", () => {
      const parts = new xdr.Int128Parts({
        hi: new xdr.Int64(-12345n),
        lo: new xdr.Uint64(67890n),
      });
      assertRoundTrip(xdr.ScVal.scvI128(parts), "i128", true);
    });

    it("handles U256", () => {
      const parts = new xdr.UInt256Parts({
        hiHi: new xdr.Uint64(1n),
        hiLo: new xdr.Uint64(2n),
        loHi: new xdr.Uint64(3n),
        loLo: new xdr.Uint64(4n),
      });
      assertRoundTrip(xdr.ScVal.scvU256(parts), "u256", true);
    });

    it("handles I256", () => {
      const parts = new xdr.Int256Parts({
        hiHi: new xdr.Int64(-1n),
        hiLo: new xdr.Uint64(2n),
        loHi: new xdr.Uint64(3n),
        loLo: new xdr.Uint64(4n),
      });
      assertRoundTrip(xdr.ScVal.scvI256(parts), "i256", true);
    });
  });

  describe("Strings, Symbols, Bytes & Addresses", () => {
    it("handles Bytes", () => {
      assertRoundTrip(xdr.ScVal.scvBytes(Buffer.from([1, 2, 3, 4])), "bytes");
      assertRoundTrip(xdr.ScVal.scvBytes(Buffer.alloc(0)), "bytes");
    });

    it("handles String", () => {
      assertRoundTrip(xdr.ScVal.scvString("hello world"), "string");
      assertRoundTrip(xdr.ScVal.scvString(""), "string");
    });

    it("handles Symbol", () => {
      assertRoundTrip(xdr.ScVal.scvSymbol("my_symbol"), "symbol", false);
    });

    it("handles Address", () => {
      const accountAddr = Address.fromString(
        "GAPMH4R4OLAAT4YSTPXUUEQYPPC3NB7P6A3W3YQIRIW33U3B4AW46HDY",
      );
      assertRoundTrip(accountAddr.toScVal(), "address", true);

      const contractAddr = Address.fromString(
        "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      );
      assertRoundTrip(contractAddr.toScVal(), "address", true);
    });
  });

  describe("Collections (Vec & Map)", () => {
    it("handles Vec", () => {
      const original = xdr.ScVal.scvVec([xdr.ScVal.scvU32(10), xdr.ScVal.scvU32(20)]);
      assertRoundTrip(original, "Vec<u32>", false);
    });

    it("handles Vec of unambiguous elements", () => {
      const original = xdr.ScVal.scvVec([xdr.ScVal.scvString("a"), xdr.ScVal.scvString("b")]);
      assertRoundTrip(original, "vec", true);
    });

    it("handles Vec with element spec", () => {
      const original = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("a"), xdr.ScVal.scvSymbol("b")]);
      assertRoundTrip(original, "Vec<Symbol>", false);
    });

    it("handles Map", () => {
      const original = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvString("key1"),
          val: xdr.ScVal.scvU32(100),
        }),
      ]);
      assertRoundTrip(original, "Map<String, u32>", false);
    });

    it("handles Map of unambiguous elements", () => {
      const original = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvString("key1"),
          val: xdr.ScVal.scvString("val1"),
        }),
      ]);
      assertRoundTrip(original, "map", true);
    });

    it("handles Map with custom specs", () => {
      const original = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("symKey"),
          val: xdr.ScVal.scvI64(new xdr.Int64(-999n)),
        }),
      ]);
      assertRoundTrip(original, "Map<Symbol, i64>", false);
    });
  });

  describe("Errors", () => {
    it("handles contract error", () => {
      const err = xdr.ScError.sceContract(1234);
      const original = xdr.ScVal.scvError(err);
      assertRoundTrip(original, "error", true);
    });

    it("handles system error (sceContext)", () => {
      const err = xdr.ScError.sceContext(xdr.ScErrorCode.scecInvalidInput());
      const original = xdr.ScVal.scvError(err);
      assertRoundTrip(original, "error", true);
    });

    it("handles system error (sceWasmVm)", () => {
      const err = xdr.ScError.sceWasmVm(xdr.ScErrorCode.scecArithDomain());
      const original = xdr.ScVal.scvError(err);
      assertRoundTrip(original, "error", true);
    });
  });

  describe("Soroban Ledger & Instance Edge Cases", () => {
    it("handles LedgerKeyContractInstance", () => {
      const original = xdr.ScVal.scvLedgerKeyContractInstance();
      assertRoundTrip(original, "ledgerKeyContractInstance", true);
    });

    it("handles LedgerKeyNonce", () => {
      const nonce = new xdr.ScNonceKey({ nonce: new xdr.Int64(12345n) });
      const original = xdr.ScVal.scvLedgerKeyNonce(nonce);
      assertRoundTrip(original, "ledgerKeyNonce", true);
    });

    it("handles ContractInstance (Stellar Asset)", () => {
      const inst = new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
        storage: null,
      });
      const original = xdr.ScVal.scvContractInstance(inst);
      assertRoundTrip(original, "contractInstance", true);
    });

    it("handles ContractInstance (Wasm Hash with Storage)", () => {
      const inst = new xdr.ScContractInstance({
        executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 7)),
        storage: [
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvString("admin"),
            val: Address.fromString(
              "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
            ).toScVal(),
          }),
        ],
      });
      const original = xdr.ScVal.scvContractInstance(inst);
      assertRoundTrip(original, "contractInstance", true);
    });
  });

  describe("Soroban xdr.ScSpecTypeDef integration", () => {
    it("converts using an ScSpecTypeDef spec parameter", () => {
      const symTypeDef = xdr.ScSpecTypeDef.scSpecTypeSymbol();
      const vecSpec = new xdr.ScSpecTypeVec({ element: symTypeDef });
      const typeDef = xdr.ScSpecTypeDef.scSpecTypeVec(vecSpec);

      const original = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol("first"),
        xdr.ScVal.scvSymbol("second"),
      ]);

      const jsVal = scvalToJs(original);
      const roundTripped = jsToScval(jsVal, typeDef);

      expect(roundTripped.toXDR().equals(original.toXDR())).toBe(true);
    });
  });
});
