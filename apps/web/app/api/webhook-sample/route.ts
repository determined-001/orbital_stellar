import { randomBytes } from "crypto";
import { signWebhookPayload } from "@orbital-stellar/pulse-webhooks";
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
  const cooldown = await checkWebhookCooldown(ip);
  if (!cooldown.ok) {
    // Fail closed, same posture as the faucet: an unconfigured Redis must not
    // silently let cooldown-bypassing traffic through.
    if (cooldown.status === 503) {
      return Response.json(cooldown.body, { status: 503 });
    }
    return Response.json(cooldown.body, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(cooldown.body.retryAfterMs / 1000)) },
    });
  }

  // Nothing this endpoint accepts is large. Reading an unbounded body - and
  // then HMAC-ing over an unbounded caller-supplied secret - is free CPU for
  // anyone who asks, on a route that exists only to show what a payload looks
  // like. Both are capped well above any legitimate input.
  const MAX_BODY_BYTES = 4_096;
  const MAX_SECRET_LENGTH = 256;
  const MAX_ADDRESS_LENGTH = 56;

  let body: Body = {};
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const raw = await req.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
        return Response.json(
          {
            error: "payload_too_large",
            message: `Request body is capped at ${MAX_BODY_BYTES} bytes.`,
          },
          { status: 413 },
        );
      }
      body = raw ? (JSON.parse(raw) as Body) : {};
    }
  } catch {
    /* allow empty or malformed body */
  }

  const callerSecret = body.secret?.trim().slice(0, MAX_SECRET_LENGTH);
  const secret = callerSecret || `whsec_demo_${randomBytes(16).toString("hex")}`;
  const generatedSecret = !callerSecret;
  const address =
    body.address?.trim().slice(0, MAX_ADDRESS_LENGTH) ||
    "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

  const event = generateSamplePayment(address);
  const payload = JSON.stringify(event);
  const timestamp = Date.now().toString();
  const signature = signWebhookPayload(payload, timestamp, secret);

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
