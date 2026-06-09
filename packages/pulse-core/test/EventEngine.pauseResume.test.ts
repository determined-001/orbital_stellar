import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

type MockStreamInstance = {
  handlers: StreamHandlers;
  close: ReturnType<typeof vi.fn>;
};

const streamInstances: MockStreamInstance[] = [];

vi.mock("@stellar/stellar-sdk", () => {
  class MockServer {
    operations() {
      return {
        cursor() {
          return {
            stream(handlers: StreamHandlers) {
              const close = vi.fn();
              streamInstances.push({ handlers, close });
              return close;
            },
          };
        },
      };
    }
  }
  return { Horizon: { Server: MockServer } };
});

import { EventEngine } from "../src/EventEngine.js";

function latestStream(): MockStreamInstance {
  const stream = streamInstances.at(-1);
  if (!stream) {
    throw new Error("Expected an active mock stream.");
  }
  return stream;
}

function makePaymentRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "payment",
    id: "1",
    paging_token: "1",
    created_at: new Date().toISOString(),
    transaction_successful: true,
    source_account: "GABC",
    from: "GABC",
    to: "GDEF",
    amount: "10.0000000",
    asset_type: "native",
    ...overrides,
  };
}

function makeContractInvokedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "contract_invocation",
    contract_id: "CABC1234",
    function: "transfer",
    topics: ["transfer"],
    data: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeContractEmittedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "contract_event",
    contract_id: "CABC1234",
    topics: ["transfer", "GABC"],
    data: { amount: "100" },
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  streamInstances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EventEngine — pause/resume per source", () => {
  describe("pauseSource() and resumeSource()", () => {
    it("pauses Horizon source and stops emitting Horizon events", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const watcher = engine.subscribe("GABC");
      const received: unknown[] = [];
      watcher.on("payment.sent", (e) => received.push(e));

      // Emit a payment event
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      expect(received).toHaveLength(1);

      // Pause Horizon source
      engine.pauseSource("horizon");

      // Emit another payment event — should be dropped
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      expect(received).toHaveLength(1);

      // Resume Horizon source
      engine.resumeSource("horizon");

      // Emit another payment event — should be received
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      expect(received).toHaveLength(2);
    });

    it("pauses Soroban source and stops emitting contract events", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const watcher = engine.subscribeContract("sub1");
      const received: unknown[] = [];
      watcher.on("contract.invoked", (e) => received.push(e));

      // Emit a contract invoked event
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(received).toHaveLength(1);

      // Pause Soroban source
      engine.pauseSource("soroban");

      // Emit another contract invoked event — should be dropped
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(received).toHaveLength(1);

      // Resume Soroban source
      engine.resumeSource("soroban");

      // Emit another contract invoked event — should be received
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(received).toHaveLength(2);
    });

    it("pausing Horizon keeps Soroban running", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const horizonWatcher = engine.subscribe("GABC");
      const sorobanWatcher = engine.subscribeContract("sub1");

      const horizonEvents: unknown[] = [];
      const sorobanEvents: unknown[] = [];

      horizonWatcher.on("payment.sent", (e) => horizonEvents.push(e));
      sorobanWatcher.on("contract.invoked", (e) => sorobanEvents.push(e));

      // Emit both types of events
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(horizonEvents).toHaveLength(1);
      expect(sorobanEvents).toHaveLength(1);

      // Pause Horizon source
      engine.pauseSource("horizon");

      // Emit both types of events again
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());

      // Horizon events should be dropped, Soroban events should be received
      expect(horizonEvents).toHaveLength(1);
      expect(sorobanEvents).toHaveLength(2);
    });

    it("pausing Soroban keeps Horizon running", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const horizonWatcher = engine.subscribe("GABC");
      const sorobanWatcher = engine.subscribeContract("sub1");

      const horizonEvents: unknown[] = [];
      const sorobanEvents: unknown[] = [];

      horizonWatcher.on("payment.sent", (e) => horizonEvents.push(e));
      sorobanWatcher.on("contract.invoked", (e) => sorobanEvents.push(e));

      // Emit both types of events
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(horizonEvents).toHaveLength(1);
      expect(sorobanEvents).toHaveLength(1);

      // Pause Soroban source
      engine.pauseSource("soroban");

      // Emit both types of events again
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());

      // Soroban events should be dropped, Horizon events should be received
      expect(horizonEvents).toHaveLength(2);
      expect(sorobanEvents).toHaveLength(1);
    });

    it("resuming continues from the last delivered cursor position", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const watcher = engine.subscribe("GABC");
      const received: unknown[] = [];
      watcher.on("payment.sent", (e) => received.push(e));

      // Emit first event
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF", amount: "10" }));
      expect(received).toHaveLength(1);
      expect((received[0] as any).amount).toBe("10");

      // Pause Horizon source
      engine.pauseSource("horizon");

      // Emit second event while paused — should be dropped
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF", amount: "20" }));
      expect(received).toHaveLength(1);

      // Resume Horizon source
      engine.resumeSource("horizon");

      // Emit third event — should be received
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF", amount: "30" }));
      expect(received).toHaveLength(2);
      expect((received[1] as any).amount).toBe("30");
    });

    it("status reflects paused state per source", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      // Initially no sources paused
      let status = engine.status();
      expect(status.pausedSources).toBeUndefined();

      // Pause Horizon
      engine.pauseSource("horizon");
      status = engine.status();
      expect(status.pausedSources).toContain("horizon");
      expect(status.pausedSources).not.toContain("soroban");

      // Pause Soroban
      engine.pauseSource("soroban");
      status = engine.status();
      expect(status.pausedSources).toContain("horizon");
      expect(status.pausedSources).toContain("soroban");

      // Resume Horizon
      engine.resumeSource("horizon");
      status = engine.status();
      expect(status.pausedSources).not.toContain("horizon");
      expect(status.pausedSources).toContain("soroban");

      // Resume Soroban
      engine.resumeSource("soroban");
      status = engine.status();
      expect(status.pausedSources).toBeUndefined();
    });

    it("warns when pausing an already paused source", () => {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const engine = new EventEngine({ network: "testnet", logger: log });
      engine.start();

      engine.pauseSource("horizon");
      expect(log.warn).not.toHaveBeenCalled();

      engine.pauseSource("horizon");
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('pauseSource("horizon") called but source is already paused')
      );
    });

    it("warns when resuming a non-paused source", () => {
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      const engine = new EventEngine({ network: "testnet", logger: log });
      engine.start();

      engine.resumeSource("horizon");
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining('resumeSource("horizon") called but source is not paused')
      );
    });

    it("clears paused sources when engine is stopped", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      engine.pauseSource("horizon");
      engine.pauseSource("soroban");

      let status = engine.status();
      expect(status.pausedSources).toHaveLength(2);

      engine.stop();

      status = engine.status();
      expect(status.pausedSources).toBeUndefined();
    });

    it("pauses contract.emitted events when Soroban is paused", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const watcher = engine.subscribeContract("sub1");
      const received: unknown[] = [];
      watcher.on("contract.emitted", (e) => received.push(e));

      // Emit a contract emitted event
      latestStream().handlers.onmessage(makeContractEmittedRecord());
      expect(received).toHaveLength(1);

      // Pause Soroban source
      engine.pauseSource("soroban");

      // Emit another contract emitted event — should be dropped
      latestStream().handlers.onmessage(makeContractEmittedRecord());
      expect(received).toHaveLength(1);

      // Resume Soroban source
      engine.resumeSource("soroban");

      // Emit another contract emitted event — should be received
      latestStream().handlers.onmessage(makeContractEmittedRecord());
      expect(received).toHaveLength(2);
    });

    it("pauses all Horizon event types when Horizon is paused", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const watcher = engine.subscribe("GABC");
      const paymentEvents: unknown[] = [];
      const allEvents: unknown[] = [];

      watcher.on("payment.sent", (e) => paymentEvents.push(e));
      watcher.on("*", (e) => allEvents.push(e));

      // Emit a payment event
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      expect(paymentEvents).toHaveLength(1);
      expect(allEvents).toHaveLength(1);

      // Pause Horizon source
      engine.pauseSource("horizon");

      // Emit another payment event — should be dropped
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      expect(paymentEvents).toHaveLength(1);
      expect(allEvents).toHaveLength(1);

      // Resume Horizon source
      engine.resumeSource("horizon");

      // Emit another payment event — should be received
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      expect(paymentEvents).toHaveLength(2);
      expect(allEvents).toHaveLength(2);
    });

    it("allows independent pause/resume cycles for each source", () => {
      const engine = new EventEngine({ network: "testnet" });
      engine.start();

      const horizonWatcher = engine.subscribe("GABC");
      const sorobanWatcher = engine.subscribeContract("sub1");

      const horizonEvents: unknown[] = [];
      const sorobanEvents: unknown[] = [];

      horizonWatcher.on("payment.sent", (e) => horizonEvents.push(e));
      sorobanWatcher.on("contract.invoked", (e) => sorobanEvents.push(e));

      // Cycle 1: Pause Horizon, keep Soroban running
      engine.pauseSource("horizon");
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(horizonEvents).toHaveLength(0);
      expect(sorobanEvents).toHaveLength(1);

      // Resume Horizon
      engine.resumeSource("horizon");
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(horizonEvents).toHaveLength(1);
      expect(sorobanEvents).toHaveLength(2);

      // Cycle 2: Pause Soroban, keep Horizon running
      engine.pauseSource("soroban");
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(horizonEvents).toHaveLength(2);
      expect(sorobanEvents).toHaveLength(2);

      // Resume Soroban
      engine.resumeSource("soroban");
      latestStream().handlers.onmessage(makePaymentRecord({ from: "GABC", to: "GDEF" }));
      latestStream().handlers.onmessage(makeContractInvokedRecord());
      expect(horizonEvents).toHaveLength(3);
      expect(sorobanEvents).toHaveLength(3);
    });
  });
});
