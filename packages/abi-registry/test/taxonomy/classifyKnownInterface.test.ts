import { describe, expect, it } from "vitest";
import { classifyKnownInterface, SEP41_SAC_INTERFACE_ID } from "../../src/taxonomy/index.js";

describe("classifyKnownInterface", () => {
  it("classifies a spec exposing all four canonical SAC events", () => {
    const spec = {
      events: [{ name: "transfer" }, { name: "mint" }, { name: "burn" }, { name: "clawback" }, { name: "approve" }],
    };
    expect(classifyKnownInterface(spec)).toBe(SEP41_SAC_INTERFACE_ID);
  });

  it("returns undefined when any of the four required events is missing", () => {
    const spec = { events: [{ name: "transfer" }, { name: "mint" }, { name: "burn" }] }; // no clawback
    expect(classifyKnownInterface(spec)).toBeUndefined();
  });

  it("returns undefined for an unrelated contract", () => {
    const spec = { events: [{ name: "swap" }, { name: "deposit" }] };
    expect(classifyKnownInterface(spec)).toBeUndefined();
  });
});
