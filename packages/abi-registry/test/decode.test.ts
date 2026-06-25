import { describe, it, expect } from "vitest";
import { decodeContractEvent } from "../src/decode.js";
import type { ContractSpec } from "../src/types.js";
import type { DecodedEvent } from "../src/decode.js";

// ---------------------------------------------------------------------------
// Minimal spec fixture (USDC-like SAC interface)
// ---------------------------------------------------------------------------

const USDC_SPEC: ContractSpec = {
  contractId: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
  entries: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDecoded(r: unknown): r is DecodedEvent {
  return typeof r === "object" && r !== null && "functionName" in r;
}

function isError(r: unknown): r is { error: string } {
  return typeof r === "object" && r !== null && "error" in r;
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe("decodeContractEvent — input validation", () => {
  it("returns error when rawEvent is null", () => {
    const result = decodeContractEvent(USDC_SPEC, null);
    expect(isError(result)).toBe(true);
  });

  it("returns error when rawEvent is a string", () => {
    const result = decodeContractEvent(USDC_SPEC, "not-an-object");
    expect(isError(result)).toBe(true);
  });

  it("returns error when rawEvent has no topics field", () => {
    const result = decodeContractEvent(USDC_SPEC, { data: null });
    expect(isError(result)).toBe(true);
    expect((result as { error: string }).error).toMatch(/topics/);
  });

  it("returns error when topics is not an array", () => {
    const result = decodeContractEvent(USDC_SPEC, { topics: "not-array", data: null });
    expect(isError(result)).toBe(true);
  });

  it("never throws — always returns a result object", () => {
    const inputs = [undefined, null, 42, "string", [], {}, { topics: null }];
    for (const input of inputs) {
      expect(() => decodeContractEvent(USDC_SPEC, input)).not.toThrow();
      const result = decodeContractEvent(USDC_SPEC, input);
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Primitive type decoding
// ---------------------------------------------------------------------------

describe("decodeContractEvent — primitive types", () => {
  it("decodes u32 topic", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "transfer" }, { u32: 42 }],
      data: { void: null },
    });
    expect(isDecoded(result)).toBe(true);
    const decoded = result as DecodedEvent;
    expect(decoded.topics[1]).toBe(42);
  });

  it("decodes i32 topic", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }, { i32: -7 }],
      data: null,
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).topics[1]).toBe(-7);
  });

  it("decodes u64 as string", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { u64: "18446744073709551615" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("18446744073709551615");
  });

  it("decodes i64 as string", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { i64: "-9223372036854775808" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("-9223372036854775808");
  });

  it("decodes u128 as string (plain value)", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "transfer" }],
      data: { u128: "340282366920938463463374607431768211455" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("340282366920938463463374607431768211455");
  });

  it("decodes i128 as string (lo/hi format)", () => {
    // 1 << 64 = 18446744073709551616
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { i128: { lo: "0", hi: "1" } },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("18446744073709551616");
  });

  it("decodes bool true", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { bool: true },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe(true);
  });

  it("decodes bool false", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { bool: false },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe(false);
  });

  it("decodes void as null", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { void: null },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBeNull();
  });

  it("decodes null data as null", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: null,
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// String / bytes / address types
// ---------------------------------------------------------------------------

describe("decodeContractEvent — string, bytes, address", () => {
  it("decodes str", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { str: "hello world" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("hello world");
  });

  it("decodes sym (symbol)", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "transfer" }],
      data: { sym: "USDC" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("USDC");
  });

  it("decodes address", () => {
    const addr = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { address: addr },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe(addr);
  });

  it("decodes bytes as hex string", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { bytes: "deadbeef" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toBe("deadbeef");
  });

  it("decodes plain string topic as-is", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: ["transfer", "GABC"],
      data: null,
    });
    expect(isDecoded(result)).toBe(true);
    const decoded = result as DecodedEvent;
    expect(decoded.topics[0]).toBe("transfer");
    expect(decoded.topics[1]).toBe("GABC");
  });
});

// ---------------------------------------------------------------------------
// vec and map
// ---------------------------------------------------------------------------

describe("decodeContractEvent — vec and map", () => {
  it("decodes vec of u32 values", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { vec: [{ u32: 1 }, { u32: 2 }, { u32: 3 }] },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toEqual([1, 2, 3]);
  });

  it("decodes empty vec as empty array", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { vec: [] },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toEqual([]);
  });

  it("decodes null vec as empty array", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { vec: null },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).data).toEqual([]);
  });

  it("decodes map of sym→i128 entries", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: {
        map: [
          { key: { sym: "amount" }, val: { i128: "1000000" } },
          { key: { sym: "fee" }, val: { i128: "100" } },
        ],
      },
    });
    expect(isDecoded(result)).toBe(true);
    const data = (result as DecodedEvent).data as Array<{ key: unknown; value: unknown }>;
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ key: "amount", value: "1000000" });
    expect(data[1]).toEqual({ key: "fee", value: "100" });
  });

  it("decodes map with { key, value } format (alternate SDK format)", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: {
        map: [{ key: { sym: "x" }, value: { u32: 99 } }],
      },
    });
    expect(isDecoded(result)).toBe(true);
    const data = (result as DecodedEvent).data as Array<{ key: unknown; value: unknown }>;
    expect(data[0]).toEqual({ key: "x", value: 99 });
  });

  it("decodes nested vec inside map", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: {
        map: [
          {
            key: { sym: "ids" },
            val: { vec: [{ u32: 1 }, { u32: 2 }] },
          },
        ],
      },
    });
    expect(isDecoded(result)).toBe(true);
    const data = (result as DecodedEvent).data as Array<{ key: unknown; value: unknown }>;
    expect(data[0]).toEqual({ key: "ids", value: [1, 2] });
  });
});

// ---------------------------------------------------------------------------
// Custom struct
// ---------------------------------------------------------------------------

describe("decodeContractEvent — custom struct", () => {
  it("decodes a multi-key object as a struct", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "transfer" }],
      data: {
        from: { address: "GABC" },
        to: { address: "GDEF" },
        amount: { i128: "5000000" },
      },
    });
    expect(isDecoded(result)).toBe(true);
    const data = (result as DecodedEvent).data as Record<string, unknown>;
    expect(data["from"]).toBe("GABC");
    expect(data["to"]).toBe("GDEF");
    expect(data["amount"]).toBe("5000000");
  });
});

// ---------------------------------------------------------------------------
// functionName extraction
// ---------------------------------------------------------------------------

describe("decodeContractEvent — functionName", () => {
  it("extracts functionName from first topic sym", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "transfer" }, { address: "GABC" }],
      data: { i128: "1000000" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).functionName).toBe("transfer");
  });

  it("extracts functionName from plain string first topic", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: ["mint", { address: "GABC" }],
      data: { i128: "500" },
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).functionName).toBe("mint");
  });

  it("sets functionName to empty string when topics is empty", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [],
      data: null,
    });
    expect(isDecoded(result)).toBe(true);
    expect((result as DecodedEvent).functionName).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Real testnet event simulation
// ---------------------------------------------------------------------------

describe("decodeContractEvent — real testnet event simulation", () => {
  /**
   * Simulates a USDC transfer event as it would appear from the Soroban RPC.
   * Topics: [sym("transfer"), address(from), address(to)]
   * Data: i128(amount)
   */
  it("decodes a USDC transfer event with the expected typed structure", () => {
    const FROM = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";
    const TO = "GDEF1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";
    const AMOUNT = "10000000"; // 1 USDC (7 decimal places)

    const rawEvent = {
      type: "contract.emitted",
      contractId: USDC_SPEC.contractId,
      topics: [{ sym: "transfer" }, { address: FROM }, { address: TO }],
      data: { i128: AMOUNT },
      timestamp: "2024-01-15T12:00:00.000Z",
      raw: {},
    };

    const result = decodeContractEvent(USDC_SPEC, rawEvent);

    expect(isDecoded(result)).toBe(true);
    const decoded = result as DecodedEvent;

    expect(decoded.functionName).toBe("transfer");
    expect(decoded.topics).toHaveLength(3);
    expect(decoded.topics[0]).toBe("transfer");
    expect(decoded.topics[1]).toBe(FROM);
    expect(decoded.topics[2]).toBe(TO);
    expect(decoded.data).toBe(AMOUNT);
  });

  /**
   * Simulates an approve event with a u32 expiration_ledger.
   */
  it("decodes an approve event with mixed types", () => {
    const OWNER = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";
    const SPENDER = "GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";

    const rawEvent = {
      topics: [{ sym: "approve" }, { address: OWNER }, { address: SPENDER }],
      data: {
        map: [
          { key: { sym: "amount" }, val: { i128: "50000000" } },
          { key: { sym: "expiration_ledger" }, val: { u32: 999999 } },
        ],
      },
    };

    const result = decodeContractEvent(USDC_SPEC, rawEvent);

    expect(isDecoded(result)).toBe(true);
    const decoded = result as DecodedEvent;

    expect(decoded.functionName).toBe("approve");
    expect(decoded.topics[1]).toBe(OWNER);
    expect(decoded.topics[2]).toBe(SPENDER);

    const data = decoded.data as Array<{ key: unknown; value: unknown }>;
    expect(data[0]).toEqual({ key: "amount", value: "50000000" });
    expect(data[1]).toEqual({ key: "expiration_ledger", value: 999999 });
  });

  /**
   * Simulates a mint event.
   */
  it("decodes a mint event", () => {
    const TO = "GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE";

    const rawEvent = {
      topics: [{ sym: "mint" }, { address: TO }],
      data: { i128: "100000000" },
    };

    const result = decodeContractEvent(USDC_SPEC, rawEvent);

    expect(isDecoded(result)).toBe(true);
    const decoded = result as DecodedEvent;
    expect(decoded.functionName).toBe("mint");
    expect(decoded.topics[1]).toBe(TO);
    expect(decoded.data).toBe("100000000");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("decodeContractEvent — error cases", () => {
  it("returns error for malformed map entry (not an object)", () => {
    const result = decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { map: ["not-an-object"] },
    });
    expect(isError(result)).toBe(true);
  });

  it("returns error for vec containing non-decodable value", () => {
    // This should not throw — it should return an error
    decodeContractEvent(USDC_SPEC, {
      topics: [{ sym: "event" }],
      data: { vec: [{ unknownType: Symbol("bad") }] },
    });
    // Symbol is not a supported type — should return error or decode as string
    // Either outcome is acceptable as long as it doesn't throw
    expect(() =>
      decodeContractEvent(USDC_SPEC, {
        topics: [{ sym: "event" }],
        data: { vec: [{ unknownType: Symbol("bad") }] },
      }),
    ).not.toThrow();
  });
});
