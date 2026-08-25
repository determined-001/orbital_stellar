import { describe, expect, it, vi, beforeEach } from "vitest";
import { Sep31Client, MissingFieldsError, CustomerInfoNeededError } from "../src/sep31.js";
import { Sep12Client } from "../src/sep12.js";
import { Sep31StatusMachine, InvalidStatusTransitionError } from "../src/statusMachine.js";

const mockAnchorUrl = "https://testanchor.stellar.org";

describe("Sep31StatusMachine", () => {
  it("allows valid transitions", () => {
    const machine = new Sep31StatusMachine("pending_sender");
    expect(() => machine.transitionTo("pending_stellar")).not.toThrow();
    expect(machine.current).toBe("pending_stellar");
    expect(() => machine.transitionTo("pending_receiver")).not.toThrow();
    expect(() => machine.transitionTo("completed")).not.toThrow();
  });

  it("throws on invalid transitions", () => {
    const machine = new Sep31StatusMachine("completed");
    expect(() => machine.transitionTo("pending_sender")).toThrow(InvalidStatusTransitionError);
  });
});

describe("Sep31Client Lifecycle (Fixture-backed)", () => {
  let client: Sep31Client;

  beforeEach(() => {
    client = new Sep31Client(mockAnchorUrl);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("fetches /info", async () => {
    const mockInfo = {
      receive: {
        USD: {
          fee_fixed: 1,
          fee_percent: 1,
          min_amount: 5,
          max_amount: 1000,
          sender_sep12_type: "sender",
          receiver_sep12_type: "receiver",
          fields: {
            transaction: {
              routing_number: { description: "Routing number" },
              account_number: { description: "Account number" },
            },
          },
        },
      },
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockInfo,
    });

    const info = await client.info();
    expect(info.receive["USD"].fee_fixed).toBe(1);
    expect(info.receive["USD"].fields?.transaction?.["routing_number"].description).toBe(
      "Routing number",
    );
  });

  it("handles missing fields rejection path (negotiation loop)", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "transaction_info_needed",
        fields: ["routing_number", "account_number"],
      }),
    });

    await expect(
      client.initiateTransaction(
        {
          asset_code: "USD",
          sender_id: "sender1",
          receiver_id: "receiver1",
        },
        "token",
      ),
    ).rejects.toThrow(MissingFieldsError);
  });

  it("handles customer info needed rejection path (SEP-12 dependency)", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: "customer_info_needed",
        type: "receiver",
        fields: ["first_name", "last_name"],
      }),
    });

    await expect(
      client.initiateTransaction(
        {
          asset_code: "USD",
          sender_id: "sender1",
          receiver_id: "receiver1",
        },
        "token",
      ),
    ).rejects.toThrow(CustomerInfoNeededError);
  });

  it("initiates transaction successfully", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "tx123",
        stellar_account_id: "GABC...",
        stellar_memo: "memo123",
        stellar_memo_type: "text",
      }),
    });

    const res = await client.initiateTransaction(
      {
        asset_code: "USD",
        sender_id: "sender1",
        receiver_id: "receiver1",
        fields: {
          routing_number: "123",
          account_number: "456",
        },
      },
      "token",
    );

    expect(res.id).toBe("tx123");
    expect(res.stellar_account_id).toBe("GABC...");
  });

  it("polls status", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        transaction: {
          id: "tx123",
          status: "pending_stellar",
          amount_in: "100.00",
        },
      }),
    });

    const res = await client.pollStatus("tx123", "token");
    expect(res.status).toBe("pending_stellar");
    expect(res.amount_in).toBe("100.00");
  });
});

describe("SEP-12 Customer Info", () => {
  let client: Sep12Client;

  beforeEach(() => {
    client = new Sep12Client(mockAnchorUrl);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("gets customer info", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "cust123",
        status: "ACCEPTED",
        provided_fields: {
          first_name: { description: "First Name", status: "ACCEPTED" },
        },
      }),
    });

    const res = await client.getCustomer({ type: "sender", account: "GABC..." }, "token");
    expect(res.id).toBe("cust123");
    expect(res.status).toBe("ACCEPTED");
  });

  it("puts customer info", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "cust123" }),
    });

    const formData = new FormData();
    formData.append("first_name", "Alice");

    const res = await client.putCustomer(formData, "token");
    expect(res.id).toBe("cust123");
  });
});
