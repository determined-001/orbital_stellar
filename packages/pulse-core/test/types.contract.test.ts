import { describe, it, expectTypeOf } from "vitest";
import type {
  NormalizedEvent,
  ContractInvokedEvent,
  ContractEmittedEvent,
} from "../src/index.js";

describe("Contract Event Types", () => {
  it("should have ContractInvokedEvent in NormalizedEvent union", () => {
    const event: NormalizedEvent = {
      type: "contract.invoked",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      function: "transfer",
      args: ["G...", "G...", "1000"],
      ledger: 123456,
      txHash: "abc123def456",
      timestamp: "2026-05-31T09:00:00Z",
      raw: {},
    };

    expectTypeOf(event).toMatchTypeOf<ContractInvokedEvent>();
  });

  it("should have ContractEmittedEvent in NormalizedEvent union", () => {
    const event: NormalizedEvent = {
      type: "contract.emitted",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topics: ["transfer", "G...", "G..."],
      data: "AAAAEAAAAA5VbW91bnQAAAAAAA==",
      decodedData: { amount: 1000 },
      ledger: 123456,
      eventId: "000000123456789-00001",
      txHash: "abc123def456",
      inSuccessfulContractCall: true,
      timestamp: "2026-05-31T09:00:00Z",
      raw: {},
    };

    expectTypeOf(event).toMatchTypeOf<ContractEmittedEvent>();
  });

  it("should narrow type correctly in exhaustive switch with both contract event types", () => {
    const event: NormalizedEvent = {
      type: "contract.invoked",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      function: "transfer",
      args: [],
      ledger: 123456,
      txHash: "abc123def456",
      timestamp: "2026-05-31T09:00:00Z",
      raw: {},
    };

    // This should type-check without errors when both cases are handled
    const result = (() => {
      switch (event.type) {
        case "contract.invoked":
          expectTypeOf(event).toMatchTypeOf<ContractInvokedEvent>();
          return "invoked";
        case "contract.emitted":
          expectTypeOf(event).toMatchTypeOf<ContractEmittedEvent>();
          return "emitted";
        case "payment.received":
          return "payment";
        case "payment.sent":
          return "payment";
        case "payment.self":
          return "payment";
        case "account.created":
          return "account";
        case "account.options_changed":
          return "account";
        case "account.merged":
          return "account";
        case "account.bump_sequence":
          return "account";
        case "trustline.added":
          return "trustline";
        case "trustline.removed":
          return "trustline";
        case "trustline.updated":
          return "trustline";
        case "trustline.authorized":
          return "trustline";
        case "trustline.deauthorized":
          return "trustline";
        case "lp.deposited":
          return "lp";
        case "lp.withdrawn":
          return "lp";
        case "offer.created":
          return "offer";
        case "offer.updated":
          return "offer";
        case "offer.deleted":
          return "offer";
        case "data.set":
          return "data";
        case "data.cleared":
          return "data";
        case "claimable.created":
          return "claimable";
        case "claimable.claimed":
          return "claimable";
      }
    })();

    expectTypeOf(result).toMatchTypeOf<string>();
  });

  it("should allow optional decodedData field on ContractEmittedEvent", () => {
    const eventWithDecoded: ContractEmittedEvent = {
      type: "contract.emitted",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topics: ["transfer"],
      data: "raw_data",
      decodedData: { decoded: true },
      ledger: 123456,
      eventId: "event-1",
      txHash: "hash",
      inSuccessfulContractCall: true,
      timestamp: "2026-05-31T09:00:00Z",
      raw: {},
    };

    const eventWithoutDecoded: ContractEmittedEvent = {
      type: "contract.emitted",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topics: ["transfer"],
      data: "raw_data",
      ledger: 123456,
      eventId: "event-1",
      txHash: "hash",
      inSuccessfulContractCall: true,
      timestamp: "2026-05-31T09:00:00Z",
      raw: {},
    };

    expectTypeOf(eventWithDecoded).toMatchTypeOf<ContractEmittedEvent>();
    expectTypeOf(eventWithoutDecoded).toMatchTypeOf<ContractEmittedEvent>();
  });

  it("should have correct field types on ContractInvokedEvent", () => {
    const event: ContractInvokedEvent = {
      type: "contract.invoked",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      function: "transfer",
      args: ["arg1", 123, { complex: "arg" }],
      ledger: 123456,
      txHash: "abc123def456",
      timestamp: "2026-05-31T09:00:00Z",
      raw: { original: "data" },
    };

    expectTypeOf(event.type).toMatchTypeOf<"contract.invoked">();
    expectTypeOf(event.contractId).toMatchTypeOf<string>();
    expectTypeOf(event.function).toMatchTypeOf<string>();
    expectTypeOf(event.args).toMatchTypeOf<unknown[]>();
    expectTypeOf(event.ledger).toMatchTypeOf<number>();
    expectTypeOf(event.txHash).toMatchTypeOf<string>();
    expectTypeOf(event.timestamp).toMatchTypeOf<string>();
    expectTypeOf(event.raw).toMatchTypeOf<unknown>();
  });

  it("should have correct field types on ContractEmittedEvent", () => {
    const event: ContractEmittedEvent = {
      type: "contract.emitted",
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      topics: ["topic1", "topic2"],
      data: { some: "data" },
      decodedData: { decoded: "data" },
      ledger: 123456,
      eventId: "event-123",
      txHash: "abc123def456",
      inSuccessfulContractCall: true,
      timestamp: "2026-05-31T09:00:00Z",
      raw: { original: "data" },
    };

    expectTypeOf(event.type).toMatchTypeOf<"contract.emitted">();
    expectTypeOf(event.contractId).toMatchTypeOf<string>();
    expectTypeOf(event.topics).toMatchTypeOf<string[]>();
    expectTypeOf(event.data).toMatchTypeOf<unknown>();
    expectTypeOf(event.decodedData).toMatchTypeOf<unknown | undefined>();
    expectTypeOf(event.ledger).toMatchTypeOf<number>();
    expectTypeOf(event.eventId).toMatchTypeOf<string>();
    expectTypeOf(event.txHash).toMatchTypeOf<string>();
    expectTypeOf(event.inSuccessfulContractCall).toMatchTypeOf<boolean>();
    expectTypeOf(event.timestamp).toMatchTypeOf<string>();
    expectTypeOf(event.raw).toMatchTypeOf<unknown>();
  });
});
