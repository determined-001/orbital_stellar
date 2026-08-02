import express, { type Express, type Request, type Response } from "express";
import { verifyWebhook } from "@orbital-stellar/pulse-webhooks";
import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

/**
 * The receiving half of the composition: an endpoint that verifies the
 * signature Orbital sends and rejects anything that does not match.
 *
 * Two details matter and are easy to get wrong:
 *
 * 1. **Verify against the raw body.** `express.json()` parses and re-serialises,
 *    and the re-serialised bytes are not always byte-identical to what was
 *    signed. This route takes the raw text and parses it only after the
 *    signature checks out.
 * 2. **Reject, do not merely log.** A tampered payload gets a 401 and is never
 *    handed to application code.
 */

export type ReceiverOptions = {
  secret: string;
  /** Called once per verified event. */
  onEvent?: (event: NormalizedEvent) => void;
  /** Called when verification fails, for alerting. */
  onRejected?: (reason: string, request: { ip?: string }) => void;
};

export const SIGNATURE_HEADER = "x-orbital-signature";
export const TIMESTAMP_HEADER = "x-orbital-timestamp";

export function createReceiver(options: ReceiverOptions): Express {
  const app = express();

  app.get("/healthz", (_request: Request, response: Response) => {
    response.json({ ok: true });
  });

  app.post(
    "/hooks/stellar",
    express.text({ type: "*/*", limit: "1mb" }),
    (request: Request, response: Response) => {
      const signature = request.header(SIGNATURE_HEADER);
      const timestamp = request.header(TIMESTAMP_HEADER);

      if (!signature || !timestamp) {
        options.onRejected?.("missing signature headers", { ip: request.ip });
        response.status(401).json({ error: "missing_signature" });
        return;
      }

      const body = typeof request.body === "string" ? request.body : "";
      const event = verifyWebhook(body, signature, options.secret, timestamp);

      if (!event) {
        // Covers a forged signature, a tampered body, and a replayed
        // timestamp outside the tolerance window.
        options.onRejected?.("signature verification failed", { ip: request.ip });
        response.status(401).json({ error: "invalid_signature" });
        return;
      }

      options.onEvent?.(event);
      response.status(202).json({ received: event.type });
    },
  );

  return app;
}
