import { createHmac, randomBytes } from "crypto";
import { checkWebhookCooldown, clientIp } from "@/lib/demo-limits";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  /** Optional caller-supplied secret. If absent, a demo secret is generated and returned. */
  secret?: string;
  /** Optional Stellar address to embed in the sample payload. */
  address?: string;
};

function generateSamplePayment(toAddress: string) {
  const fromAddress = `G${randomBytes(28).toString("hex").toUpperCase().slice(0, 55)}`;
  return {
    type: "payment.received" as const,
    to: toAddress,
    from: fromAddress,
    amount: (Math.random() * 100 + 1).toFixed(7),
    asset: "XLM",
    timestamp: new Date().toISOString(),
    raw: {
      _comment: "Truncated for demo. Real events include the full Horizon record.",
    },
  };
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const cooldown = checkWebhookCooldown(ip);
  if (!cooldown.ok) {
    return Response.json(cooldown.body, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    });
  }

  let body: Body = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      body = (await req.json()) as Body;
    }
  } catch {
    /* allow empty body */
  }

  const secret = body.secret?.trim() || `whsec_demo_${randomBytes(16).toString("hex")}`;
  const generatedSecret = !body.secret?.trim();
  const address = body.address?.trim() || "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

  const event = generateSamplePayment(address);
  const payload = JSON.stringify(event);
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return Response.json({
    event,
    payload,
    headers: {
      "x-orbital-signature": signature,
      "x-orbital-timestamp": timestamp,
      "x-orbital-attempt": "1",
    },
    secret: generatedSecret ? secret : undefined,
    verify: {
      node: `import { verifyWebhook } from "@orbital-stellar/pulse-webhooks";\nverifyWebhook(payload, signature, secret, timestamp);`,
      edge: `import { verifyWebhookEdge } from "@orbital-stellar/pulse-webhooks/edge";\nawait verifyWebhookEdge(payload, signature, secret, timestamp);`,
    },
  });
}
