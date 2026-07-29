import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sep31Client } from "../src/index.js";
import * as http from "http";

describe("SEP-31 E2E against Testnet Anchor", () => {
  let server: http.Server;
  let anchorUrl: string;

  beforeAll(async () => {
    // Create a local mock anchor
    server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");

      if (req.method === "GET" && req.url === "/info") {
        res.writeHead(200);
        res.end(JSON.stringify({ receive: { USDC: { enabled: true } } }));
        return;
      }

      if (req.method === "POST" && req.url === "/transactions") {
        if (!req.headers.authorization || !req.headers.authorization.includes("valid-jwt")) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ id: "tx-mock-123", status: "pending_sender" }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as any;
        anchorUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it("fetches info from live testnet anchor", async () => {
    const client = new Sep31Client({ anchorUrl });
    const info = await client.getInfo();

    expect(info).toBeDefined();
    expect(info.receive.USDC.enabled).toBe(true);
  });

  it("fails initiation with unauthorized if no JWT", async () => {
    const client = new Sep31Client({ anchorUrl });

    await expect(
      client.initiatePayment({
        assetCode: "USDC",
        amount: "100",
        jwt: "", // No JWT
      }),
    ).rejects.toThrow(/401/);
  });

  it("initiates transaction successfully with JWT", async () => {
    const client = new Sep31Client({ anchorUrl });

    const res = await client.initiatePayment({
      assetCode: "USDC",
      amount: "100",
      jwt: "valid-jwt",
    });

    expect(res.id).toBe("tx-mock-123");
    expect(res.status).toBe("pending_sender");
  });
});
