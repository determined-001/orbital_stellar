import { describe, it, expect } from "vitest";
import { toContractAddress } from "@orbital-stellar/pulse-core";
import type { ContractEmittedEvent } from "@orbital-stellar/pulse-core";
import { describeContractEvent, DEMO_EMITTER_CONTRACT_ID, USDC_CONTRACT_ID } from "../src/demoContracts.js";

function event(topic: string, decodedData: unknown): ContractEmittedEvent {
  return {
    type: "contract.emitted",
    contractId: toContractAddress(DEMO_EMITTER_CONTRACT_ID),
    topics: [topic],
    data: decodedData,
    decodedData,
    timestamp: "1234567890",
    timestampDate: new Date(1234567890 * 1000),
  };
}

describe("describeContractEvent (issue #908 - real path for the generated event guards)", () => {
  it("describes a demo-emitter ping event", () => {
    expect(describeContractEvent(event("Ping", { timestamp: "12345" }))).toBe(
      "demo-emitter ping at 12345",
    );
  });

  it("describes a USDC transfer event", () => {
    expect(describeContractEvent(event("transfer", { amount: "500" }))).toBe(
      "USDC transfer of 500",
    );
  });

  it("describes a USDC mint event", () => {
    expect(describeContractEvent(event("mint", { amount: "100" }))).toBe("USDC mint of 100");
  });

  it("describes a USDC burn event", () => {
    expect(describeContractEvent(event("burn", { amount: "50" }))).toBe("USDC burn of 50");
  });

  it("returns null for an event neither contract's generated types recognize", () => {
    expect(describeContractEvent(event("clawback", { amount: "1" }))).toBeNull();
  });

  it("returns null when the topic matches but the decoded data fails schema validation", () => {
    expect(describeContractEvent(event("Ping", { timestamp: 12345 }))).toBeNull();
  });
});

// USDC_CONTRACT_ID mirrors the well-known contract orbital.config.ts targets - a
// literal-value check that also catches an accidental future rename/typo.
describe("USDC_CONTRACT_ID", () => {
  it("matches the well-known mainnet USDC contract", () => {
    expect(USDC_CONTRACT_ID).toBe("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75");
  });
});
