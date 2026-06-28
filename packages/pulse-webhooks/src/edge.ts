import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

import type { VerifyWebhookOptions } from "./types.js";
import { DEFAULT_CLOCK_SKEW_MS, DEFAULT_MAX_AGE_MS } from "./types.js";

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

  // Enforce replay window: reject timestamps older than maxAgeMs (default 5 min) plus allowed clock skew.
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (timestampMs < nowMs - maxAgeMs - clockSkewMs) return false;

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

/**
 * Verifies a webhook whose body arrives as a ReadableStream using Web Crypto API.
 * The stream is consumed exactly once: chunks are buffered and fed to an HMAC
 * computation incrementally, so the caller never needs to buffer the body separately.
 *
 * @param stream - The raw request body as a ReadableStream<Uint8Array>
 * @param signature - The x-orbital-signature header value
 * @param secret - Your webhook secret
 * @param timestamp - The x-orbital-timestamp header value
 * @param options - Optional replay-window options (`maxAgeMs`, `clockSkewMs`, `nowMs`)
 * @returns `{ event, body }` where `event` is the parsed NormalizedEvent and `body`
 *          is the buffered UTF-8 string, or `null` if verification fails
 */
export async function verifyWebhookEdgeStream(
  stream: ReadableStream<Uint8Array>,
  signature: string,
  secret: string,
  timestamp: string,
  options: VerifyWebhookOptions = {},
): Promise<{ event: NormalizedEvent; body: string } | null> {
  if (!/^\d+$/.test(timestamp)) return null;

  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) return null;

  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;
  const nowMs = options.nowMs ?? Date.now();

  if (timestampMs > nowMs + clockSkewMs) return null;

  if (options.maxAgeMs !== undefined) {
    if (timestampMs < nowMs - options.maxAgeMs - clockSkewMs) return null;
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

    // Buffer all chunks from the stream.
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Concatenate into a single buffer.
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const bodyBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset);
      offset += chunk.length;
    }

    const body = new TextDecoder().decode(bodyBytes);

    // Build the signed payload: "<timestamp>.<body>".
    const signedPayload = `${timestamp}.${body}`;
    const expectedBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload),
    );

    const signatureBytes = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );
    const expectedBytes = new Uint8Array(expectedBuffer);
    if (expectedBytes.length !== signatureBytes.length) return null;

    let result = 0;
    for (let i = 0; i < expectedBytes.length; i++) {
      result |= (expectedBytes[i] || 0) ^ (signatureBytes[i] || 0);
    }
    if (result !== 0) return null;

    const evt = JSON.parse(body) as NormalizedEvent;
    if (options.schema) {
      try {
        if (!options.schema(evt)) return null;
      } catch {
        return null;
      }
    }

    return { event: evt, body };
  } catch {
    return null;
  }
}
