import { expect, describe, it, vi, beforeEach } from "vitest";
import { normalizeContractEvent } from "../src/EventEngine.js";

describe("Soroban Event Normalizer Utility Suite", () => {
  
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should process a representative testnet event sample into a typed ContractEmittedEvent", () => {
    const mockTestnetEvent = {
      type: "contract",
      ledger: 485921,
      ledgerClosedAt: "2026-05-31T09:00:00Z",
      contractId: "CBB76TESTNETCONTRACTIDXXXXXXXXXXXXXXXYZZZZZZZZZZ",
      id: "000000123456789-00001",
      pagingToken: "000000123456789-00001",
      topic: ["transfer", "G...", "G..."],
      value: "AAAAEAAAAA5VbW91bnQAAAAAAA==",
      inSuccessfulContractCall: true,
      txHash: "f1a2b3c4d5e6f7a8b9c0f1a2b3c4d5e6f7a8b9c0f1a2b3c4d5e6f7a8b9c01234",
    };

    const result = normalizeContractEvent(mockTestnetEvent);

    expect(result).not.toBeNull();
    expect(result!.type).toBe("contract_emitted");
    expect(result!.id).toBe("000000123456789-00001");
    expect(result!.pagingToken).toBe("000000123456789-00001");
    expect(result!.contractId).toBe("CBB76TESTNETCONTRACTIDXXXXXXXXXXXXXXXYZZZZZZZZZZ");
    
    const emittedEvent = result as any;
    expect(emittedEvent.topics).toEqual(["transfer", "G...", "G..."]);
    expect(emittedEvent.value).toBe("AAAAEAAAAA5VbW91bnQAAAAAAA==");
    expect(emittedEvent.raw).toStrictEqual(mockTestnetEvent);
  });

  it("should output null and log a console warning for broken payloads instead of throwing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const brokenPayload = {
      type: "contract",
      ledger: 485921,
    };

    const result = normalizeContractEvent(brokenPayload);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
