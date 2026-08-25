import { describe, expect, it, vi } from "vitest";
import {
  Sep24Client,
  Sep24CustomerInfoNeededError,
  Sep24Error,
  Sep24StatusMachine,
  InvalidSep24TransitionError,
  SEP24_TERMINAL_STATUSES,
  discoverAnchor,
  parseStellarToml,
  Sep1DiscoveryError,
} from "../src/index.js";

const ANCHOR = "https://anchor.example.com/sep24";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function transportReturning(...responses: Response[]) {
  const queue = [...responses];
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
  return { transport, calls };
}

describe("SEP-1 discovery", () => {
  it("parses the endpoints this SDK needs out of a stellar.toml", () => {
    const toml = parseStellarToml(`
      # comment
      NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"
      WEB_AUTH_ENDPOINT = "https://anchor.example.com/auth"
      TRANSFER_SERVER_SEP0024 = "https://anchor.example.com/sep24"
      SIGNING_KEY = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"

      [[CURRENCIES]]
      TRANSFER_SERVER_SEP0024 = "https://not-the-top-level.example.com"
    `);

    expect(toml.WEB_AUTH_ENDPOINT).toBe("https://anchor.example.com/auth");
    expect(toml.TRANSFER_SERVER_SEP0024).toBe("https://anchor.example.com/sep24");
    expect(toml.KYC_SERVER).toBeUndefined();
  });

  it("fetches .well-known/stellar.toml from a home domain", async () => {
    const { transport, calls } = transportReturning(
      new Response(`WEB_AUTH_ENDPOINT = "https://anchor.example.com/auth"`, { status: 200 }),
    );

    const toml = await discoverAnchor("anchor.example.com", { transport });

    expect(calls[0]!.url).toBe("https://anchor.example.com/.well-known/stellar.toml");
    expect(toml.WEB_AUTH_ENDPOINT).toBe("https://anchor.example.com/auth");
  });

  it("throws a discovery error on a non-2xx response", async () => {
    const { transport } = transportReturning(new Response("nope", { status: 404 }));
    await expect(discoverAnchor("anchor.example.com", { transport })).rejects.toBeInstanceOf(
      Sep1DiscoveryError,
    );
  });
});

// SEP-10 coverage lives in test/sep10.test.ts - it needs a real challenge
// transaction, which needs a server keypair to build.

describe("SEP-24 client", () => {
  it("reads /info", async () => {
    const { transport, calls } = transportReturning(
      jsonResponse({ deposit: { USDC: { enabled: true, min_amount: 1 } } }),
    );
    const info = await new Sep24Client(ANCHOR, { transport }).info();

    expect(calls[0]!.url).toBe(`${ANCHOR}/info`);
    expect(info.deposit?.USDC?.enabled).toBe(true);
  });

  it("initiates an interactive deposit and returns the id to poll", async () => {
    const { transport, calls } = transportReturning(
      jsonResponse({
        type: "interactive_customer_info_needed",
        url: "https://anchor.example.com/interactive?token=abc",
        id: "tx-1",
      }),
    );

    const response = await new Sep24Client(ANCHOR, { transport }).initiateDeposit(
      { asset_code: "USDC", amount: "100" },
      "jwt",
    );

    expect(calls[0]!.url).toBe(`${ANCHOR}/transactions/deposit/interactive`);
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
    expect(response.id).toBe("tx-1");
  });

  it("surfaces a customer-info requirement as a typed error naming the fields", async () => {
    const { transport } = transportReturning(
      jsonResponse(
        { type: "non_interactive_customer_info_needed", fields: ["email_address", "first_name"] },
        403,
      ),
    );

    await expect(
      new Sep24Client(ANCHOR, { transport }).initiateWithdrawal({ asset_code: "USDC" }, "jwt"),
    ).rejects.toMatchObject({
      name: "Sep24CustomerInfoNeededError",
      fields: ["email_address", "first_name"],
    });
  });

  it("polls a transaction and unwraps the envelope", async () => {
    const { transport, calls } = transportReturning(
      jsonResponse({
        transaction: { id: "tx-1", kind: "deposit", status: "pending_anchor" },
      }),
    );

    const tx = await new Sep24Client(ANCHOR, { transport }).transaction("tx-1", "jwt");

    expect(calls[0]!.url).toContain("id=tx-1");
    expect(tx.status).toBe("pending_anchor");
  });

  it("rejects a body that does not match the schema rather than guessing", async () => {
    const { transport } = transportReturning(
      jsonResponse({ transaction: { id: "tx-1", kind: "deposit", status: "not-a-sep24-status" } }),
    );

    await expect(
      new Sep24Client(ANCHOR, { transport }).transaction("tx-1", "jwt"),
    ).rejects.toBeInstanceOf(Sep24Error);
  });
});

describe("SEP-24 status machine", () => {
  it("walks a normal deposit to completion", () => {
    const machine = new Sep24StatusMachine();
    expect(machine.transitionTo("pending_user_transfer_start")).toBe(true);
    machine.transitionTo("pending_anchor");
    machine.transitionTo("pending_stellar");
    machine.transitionTo("completed");

    expect(machine.current).toBe("completed");
    expect(machine.isTerminal).toBe(true);
    expect(machine.history).toEqual([
      "incomplete",
      "pending_user_transfer_start",
      "pending_anchor",
      "pending_stellar",
      "completed",
    ]);
  });

  it("treats a repeated poll of the same status as a no-op", () => {
    const machine = new Sep24StatusMachine("pending_anchor");
    expect(machine.transitionTo("pending_anchor")).toBe(false);
    expect(machine.history).toEqual(["pending_anchor"]);
  });

  it("refuses an illegal transition instead of overwriting", () => {
    const machine = new Sep24StatusMachine("completed");
    expect(() => machine.transitionTo("pending_anchor")).toThrow(InvalidSep24TransitionError);
    expect(machine.current).toBe("completed");
  });

  it("lets nothing leave a terminal status", () => {
    for (const terminal of SEP24_TERMINAL_STATUSES) {
      const machine = new Sep24StatusMachine(terminal);
      expect(machine.isTerminal).toBe(true);
      expect(() => machine.transitionTo("pending_anchor")).toThrow(InvalidSep24TransitionError);
    }
  });

  it("never re-enters incomplete once the flow has started", () => {
    const machine = new Sep24StatusMachine("pending_anchor");
    expect(machine.canTransitionTo("incomplete")).toBe(false);
  });
});
