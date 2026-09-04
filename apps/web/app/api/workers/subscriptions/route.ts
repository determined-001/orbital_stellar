import {
  MemorySubscriptionStore,
  SubscriptionError,
  SubscriptionService,
  type SubscriptionRecord,
  type SubscriptionTier,
} from "@orbital-stellar/worker-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `GET  /api/workers/subscriptions?subscriber=…` — a subscriber's own
 * subscriptions (20.5's "queryable by the subscriber", the read half 19.4
 * builds on).
 * `POST /api/workers/subscriptions` — create one.
 *
 * The store here is in-process, which means it is per-instance and does not
 * survive a restart. That is deliberate and temporary: 20.5 owns the record
 * and its lifecycle, and the durable store lands with the rest of W2. Wiring
 * a half-designed schema into Postgres now would be the harder thing to undo.
 *
 * Nothing this route accepts or returns is a credential. There is no field to
 * send a key, an allowance or an address to draw from, because
 * `SubscriptionRecord` has none — see the type-level assertion in
 * `packages/worker-core/test/subscription/noAuthority.test-d.ts`.
 */

const MAX_BODY_BYTES = 4_096;

// One window is the payroll-shaped default the W0 tier is built around. The
// real value comes from the offering once 20.1 lands; the service only needs
// to be told which window it is in.
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const store = new MemorySubscriptionStore();
const subscriptions = new SubscriptionService({
  store,
  currentWindow: () => Math.floor(Date.now() / WINDOW_MS),
});

/**
 * Who is asking.
 *
 * Reads a header rather than trusting a body field: a subscriber id in the
 * request body is a request to read someone else's subscriptions. Real
 * authentication arrives with 19.4; until then this route refuses rather than
 * defaulting to "everyone", so it cannot quietly become an open read of every
 * subscription in the process.
 */
function subscriberFrom(req: Request): string | null {
  return req.headers.get("x-orbital-subscriber")?.trim() || null;
}

function errorResponse(err: unknown): Response {
  if (err instanceof SubscriptionError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "ALREADY_CANCELLED" || err.code === "INVALID_TRANSITION"
          ? 409
          : 400;
    return Response.json({ error: err.code, message: err.message }, { status });
  }
  return Response.json(
    { error: "internal_error", message: "Subscription request failed." },
    { status: 500 },
  );
}

/** The record as the API returns it. Explicit, so a new field is a decision. */
function present(record: SubscriptionRecord) {
  return {
    id: record.id,
    subscriber: record.subscriber,
    offering: record.offering,
    webhookTarget: record.webhookTarget,
    tier: record.tier,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    cancelEffectiveWindow: record.cancelEffectiveWindow,
    audit: record.audit,
  };
}

export async function GET(req: Request): Promise<Response> {
  const subscriber = subscriberFrom(req);
  if (!subscriber) {
    return Response.json(
      {
        error: "unauthenticated",
        message: "Send the subscriber identity in the x-orbital-subscriber header.",
      },
      { status: 401 },
    );
  }

  const requested = new URL(req.url).searchParams.get("subscriber");
  if (requested && requested !== subscriber) {
    // Scoped to the caller, always. A subscription is not sensitive because of
    // what it can do — it can do nothing — but it names an offering and a
    // webhook target, and neither is anyone else's to read.
    return Response.json(
      { error: "forbidden", message: "A subscriber may only read their own subscriptions." },
      { status: 403 },
    );
  }

  try {
    const records = await subscriptions.listBySubscriber(subscriber);
    return Response.json({ subscriptions: records.map(present) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  const subscriber = subscriberFrom(req);
  if (!subscriber) {
    return Response.json(
      {
        error: "unauthenticated",
        message: "Send the subscriber identity in the x-orbital-subscriber header.",
      },
      { status: 401 },
    );
  }

  let body: { offering?: unknown; webhookTarget?: unknown; tier?: unknown };
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return Response.json(
        { error: "payload_too_large", message: `Body is capped at ${MAX_BODY_BYTES} bytes.` },
        { status: 413 },
      );
    }
    body = raw ? (JSON.parse(raw) as typeof body) : {};
  } catch {
    return Response.json({ error: "invalid_json", message: "Body must be JSON." }, { status: 400 });
  }

  if (typeof body.offering !== "string" || typeof body.webhookTarget !== "string") {
    return Response.json(
      { error: "invalid_field", message: "offering and webhookTarget are required strings." },
      { status: 400 },
    );
  }

  try {
    const record = await subscriptions.create({
      // From the header, never the body: a body-supplied subscriber id is a
      // request to create a subscription in someone else's name.
      subscriber,
      offering: body.offering,
      webhookTarget: body.webhookTarget,
      tier: (body.tier as SubscriptionTier) ?? "time-insensitive",
    });
    return Response.json(present(record), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
