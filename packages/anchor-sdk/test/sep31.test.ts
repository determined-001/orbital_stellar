import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sep31Client, MissingFieldsError, validateTransition } from "../src/index.js";

describe("SEP-31 Client Lifecycle", () => {
  let client: Sep31Client;
  const mockAnchor = "https://mock.anchor";

  beforeEach(() => {
    client = new Sep31Client({ anchorUrl: mockAnchor });
    global.fetch = vi.fn();
  });

  it("fetches info", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ receive: { USDC: { enabled: true } } }), { status: 200 }),
    );

    const info = await client.getInfo();
    expect(info.receive.USDC.enabled).toBe(true);
    expect(fetch).toHaveBeenCalledWith(`${mockAnchor}/info`);
  });

  it("initiates payment successfully", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "tx-123", status: "pending_sender" }), { status: 200 }),
    );

    const res = await client.initiatePayment({
      assetCode: "USDC",
      amount: "100",
      jwt: "mock-jwt",
    });

    expect(res.id).toBe("tx-123");
    expect(res.status).toBe("pending_sender");
  });

  it("handles missing fields negotiation explicitly", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "customer_info_needed",
          fields: {
            transaction: {
              receiver_routing_number: { description: "routing number" },
            },
          },
        }),
        { status: 400 },
      ),
    );

    await expect(
      client.initiatePayment({
        assetCode: "USDC",
        amount: "100",
        jwt: "mock-jwt",
      }),
    ).rejects.toThrow(MissingFieldsError);
  });

  it("normalizes into anchor.payment event while preserving status", () => {
    const rawTx = {
      id: "tx-123",
      stellar_account_id: "GABC...",
      amount_in: "100",
      amount_in_asset: "USDC",
      status: "pending_stellar",
      started_at: "2023-01-01T00:00:00Z",
    };

    const event = client.normalizeEvent(rawTx);
    expect(event.type).toBe("anchor.payment");
    expect(event.payment_id).toBe("tx-123");
    expect(event.protocol_status.protocol).toBe("sep31");
    expect(event.protocol_status.status).toBe("pending_stellar");
    expect(event.timestamp).toBe("2023-01-01T00:00:00Z");
  });
});

describe("SEP-31 Status Machine", () => {
  it("validates valid transitions", () => {
    expect(() => validateTransition("pending_sender", "pending_stellar")).not.toThrow();
    expect(() => validateTransition("pending_stellar", "completed")).not.toThrow();
  });

  it("rejects invalid transitions", () => {
    expect(() => validateTransition("pending_stellar", "pending_sender")).toThrow();
    expect(() => validateTransition("completed", "pending_receiver")).toThrow();
  });
});
