import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signWebhookPayload } from "@orbital-stellar/pulse-webhooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileCursorStore } from "@orbital-stellar/pulse-core";
import { createReceiver, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../src/receiver.js";
import { loadConfig, MissingConfigError } from "../src/config.js";

const SECRET = "0123456789abcdef0123456789abcdef";
const STREAM_KEY = "horizon:testnet";

function signedRequest(body: string, secret = SECRET) {
  // The header carries milliseconds - `verifyWebhook` compares it against
  // Date.now() directly, so a seconds-precision value reads as ancient.
  const timestamp = String(Date.now());
  return { body, timestamp, signature: signWebhookPayload(body, timestamp, secret) };
}

function paymentPayload(): string {
  return JSON.stringify({
    type: "payment.received",
    to: "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX",
    from: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    amount: "10.0000000",
    asset: "XLM",
    timestamp: "2026-08-02T12:00:00Z",
  });
}

/** Starts the receiver on an ephemeral port and returns its base URL. */
async function listen(app: ReturnType<typeof createReceiver>) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("webhook receiver (#897)", () => {
  it("accepts a correctly signed delivery and surfaces the event", async () => {
    const received: string[] = [];
    const app = createReceiver({ secret: SECRET, onEvent: (event) => received.push(event.type) });
    const server = await listen(app);

    const { body, timestamp, signature } = signedRequest(paymentPayload());
    const response = await fetch(`${server.url}/hooks/stellar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: timestamp,
      },
      body,
    });

    expect(response.status).toBe(202);
    expect(received).toEqual(["payment.received"]);
    await server.close();
  });

  it("rejects a tampered payload with 401 and never surfaces it", async () => {
    const rejections: string[] = [];
    const received: string[] = [];
    const app = createReceiver({
      secret: SECRET,
      onEvent: (event) => received.push(event.type),
      onRejected: (reason) => rejections.push(reason),
    });
    const server = await listen(app);

    const { body, timestamp, signature } = signedRequest(paymentPayload());
    // One digit changed after signing - the classic tamper.
    const tampered = body.replace('"10.0000000"', '"1000.0000000"');

    const response = await fetch(`${server.url}/hooks/stellar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: timestamp,
      },
      body: tampered,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
    expect(received).toEqual([]);
    expect(rejections).toHaveLength(1);
    await server.close();
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    const app = createReceiver({ secret: SECRET });
    const server = await listen(app);

    const { body, timestamp, signature } = signedRequest(
      paymentPayload(),
      "a-different-secret-32b",
    );
    const response = await fetch(`${server.url}/hooks/stellar`, {
      method: "POST",
      headers: { [SIGNATURE_HEADER]: signature, [TIMESTAMP_HEADER]: timestamp },
      body,
    });

    expect(response.status).toBe(401);
    await server.close();
  });

  it("rejects a delivery with no signature headers", async () => {
    const app = createReceiver({ secret: SECRET });
    const server = await listen(app);

    const response = await fetch(`${server.url}/hooks/stellar`, {
      method: "POST",
      body: paymentPayload(),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "missing_signature" });
    await server.close();
  });

  it("answers /healthz", async () => {
    const server = await listen(createReceiver({ secret: SECRET }));
    const response = await fetch(`${server.url}/healthz`);
    expect(await response.json()).toEqual({ ok: true });
    await server.close();
  });
});

describe("cursor resume after restart (#897)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "orbital-express-starter-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a second process reads the cursor the first one persisted", async () => {
    // First "run": ingest up to paging token 4242 and shut down.
    const first = new FileCursorStore(dir);
    await first.set(STREAM_KEY, "4242");

    // Second "run": a brand-new store instance over the same directory, which
    // is what a restarted container sees.
    const second = new FileCursorStore(dir);
    expect(await second.get(STREAM_KEY)).toBe("4242");
  });

  it("reports no cursor for a stream it has never seen, rather than a stale one", async () => {
    const store = new FileCursorStore(dir);
    await store.set(STREAM_KEY, "4242");

    expect(await store.get("horizon:mainnet")).toBeNull();
  });

  it("advances monotonically as events arrive", async () => {
    const store = new FileCursorStore(dir);
    for (const cursor of ["1", "2", "3"]) {
      await store.set(STREAM_KEY, cursor);
    }

    expect(await new FileCursorStore(dir).get(STREAM_KEY)).toBe("3");
  });
});

describe("configuration", () => {
  const base = {
    STELLAR_ADDRESSES: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    WEBHOOK_SECRET: SECRET,
  };

  it("defaults to testnet with a file-backed cursor and this process's receiver", () => {
    const config = loadConfig({ ...base } as NodeJS.ProcessEnv);

    expect(config.network).toBe("testnet");
    expect(config.databaseUrl).toBeUndefined();
    expect(config.webhookUrl).toBe("http://127.0.0.1:3000/hooks/stellar");
  });

  it("refuses to start with no addresses", () => {
    expect(() => loadConfig({ WEBHOOK_SECRET: SECRET } as NodeJS.ProcessEnv)).toThrow(
      MissingConfigError,
    );
  });

  it("refuses a webhook secret too short to be one", () => {
    expect(() => loadConfig({ ...base, WEBHOOK_SECRET: "short" } as NodeJS.ProcessEnv)).toThrow(
      /at least 16 characters/,
    );
  });

  it("refuses a non-numeric port instead of listening on NaN", () => {
    expect(() => loadConfig({ ...base, PORT: "not-a-port" } as NodeJS.ProcessEnv)).toThrow(
      MissingConfigError,
    );
  });

  it("switches to mainnet only on an exact match", () => {
    expect(loadConfig({ ...base, STELLAR_NETWORK: "mainnet" } as NodeJS.ProcessEnv).network).toBe(
      "mainnet",
    );
    expect(loadConfig({ ...base, STELLAR_NETWORK: "Mainnet" } as NodeJS.ProcessEnv).network).toBe(
      "testnet",
    );
  });
});

describe("graceful shutdown (#897)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops the engine and flushes the cursor before the process exits", async () => {
    const order: string[] = [];

    const service = {
      port: 0,
      cursorKind: "file" as const,
      stop: vi.fn(async () => {
        order.push("stop");
      }),
    };

    const { installSignalHandlers } = await import("../src/service.js");
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      order.push(`exit:${code}`);
      return undefined as never;
    }) as never);

    const uninstall = installSignalHandlers(service);
    process.emit("SIGTERM");

    // Let the stop promise settle.
    await vi.waitFor(() => expect(order).toContain("exit:0"));

    // stop() ran to completion *before* exit was called - that ordering is the
    // whole point: exiting first loses the final cursor write.
    expect(order).toEqual(["stop", "exit:0"]);
    expect(service.stop).toHaveBeenCalledOnce();

    uninstall();
    exit.mockRestore();
  });
});

describe("receiver rate limiting (#897)", () => {
  it("returns 429 once an IP is over budget, before doing HMAC work", async () => {
    const rejections: string[] = [];
    const app = createReceiver({
      secret: SECRET,
      rateLimit: 2,
      rateLimitWindowMs: 60_000,
      onRejected: (reason) => rejections.push(reason),
    });
    const server = await listen(app);

    const send = async () => {
      const { body, timestamp, signature } = signedRequest(paymentPayload());
      return fetch(`${server.url}/hooks/stellar`, {
        method: "POST",
        headers: { [SIGNATURE_HEADER]: signature, [TIMESTAMP_HEADER]: timestamp },
        body,
      });
    };

    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(202);

    const limited = await send();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect(rejections).toContain("rate limit exceeded");

    await server.close();
  });

  it("lets a caller through again once the window rolls over", async () => {
    const app = createReceiver({ secret: SECRET, rateLimit: 1, rateLimitWindowMs: 250 });
    const server = await listen(app);

    const send = async () => {
      const { body, timestamp, signature } = signedRequest(paymentPayload());
      return fetch(`${server.url}/hooks/stellar`, {
        method: "POST",
        headers: { [SIGNATURE_HEADER]: signature, [TIMESTAMP_HEADER]: timestamp },
        body,
      });
    };

    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(429);

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect((await send()).status).toBe(202);

    await server.close();
  });
});
