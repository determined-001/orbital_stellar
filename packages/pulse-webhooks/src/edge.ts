import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

import type { VerifyWebhookOptions } from "./types.js";
import { DEFAULT_CLOCK_SKEW_MS } from "./types.js";

/**
 * Verifies webhook signatures using Web Crypto API (compatible with Cloudflare Workers, Deno, and browsers)
 *
 * @param payload - The raw request body
 * @param signature - The x-orbital-signature header value
 * @param secret - Your webhook secret
 * @param timestamp - The x-orbital-timestamp header value
 * @param options - Optional replay-window options (`maxAgeMs`, `clockSkewMs`, `nowMs`)
 * @returns Parsed NormalizedEvent if verification succeeds, null otherwise
 */
export async function verifyWebhookEdge(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): Promise<NormalizedEvent | null> {
  // Enforce maximum body size before any cryptographic work.
  const maxBodyBytes = options.maxBodyBytes ?? 100_000;
  // Measure payload size in bytes.
  const payloadBytes = new TextEncoder().encode(payload).length;
  if (payloadBytes > maxBodyBytes) return null;
  if (!(await verifyWebhookEdgeRaw(payload, signature, secret, timestamp, options))) {
    return null;
  }
  try {
    const evt = JSON.parse(payload) as NormalizedEvent;
    if (options.schema) {
      try {
        if (!options.schema(evt)) return null;
      } catch {
        return null;
      }
    }
    return evt;
  } catch {
    return null;
  }
}

/**
 * Verifies webhook signature without parsing JSON using Web Crypto API.
 * Use when routing the raw body to another consumer (e.g., a queue) to avoid the parse overhead.
 *
 * @param payload - The raw request body
 * @param signature - The x-orbital-signature header value
 * @param secret - Your webhook secret
 * @param timestamp - The x-orbital-timestamp header value
 * @param options - Optional replay-window options
 * @returns Promise<true> if signature is valid, Promise<false> otherwise
 */
export async function verifyWebhookEdgeRaw(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  if (!/^\d+$/.test(timestamp)) return false;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return false;

  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const nowMs = options.nowMs ?? Date.now();

  // Reject timestamps from the future (beyond clock skew allowance).
  if (timestampMs > nowMs + clockSkewMs) return false;

  // Only enforce the replay window when maxAgeMs is explicitly configured.
  // Omitting it preserves pre-existing behaviour (no age rejection).
  if (options.maxAgeMs !== undefined) {
    if (timestampMs < nowMs - options.maxAgeMs - clockSkewMs) return false;
  }

  try {
    const keyData = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signedPayload = `${timestamp}.${payload}`;
    const expectedBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload),
    );
    const signatureBytes = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );
    const expectedBytes = new Uint8Array(expectedBuffer);
    if (expectedBytes.length !== signatureBytes.length) return false;
    let result = 0;
    for (let i = 0; i < expectedBytes.length; i++) {
      result |= (expectedBytes[i] || 0) ^ (signatureBytes[i] || 0);
    }
    return result === 0;
  } catch {
    return false;
  }
}
