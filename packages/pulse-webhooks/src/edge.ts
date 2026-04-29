import type { NormalizedEvent } from "@orbital/pulse-core";

/**
 * Verifies webhook signatures using Web Crypto API (compatible with Cloudflare Workers, Deno, and browsers)
 *
 * @param payload - The raw request body
 * @param signature - The x-orbital-signature header value
 * @param secret - Your webhook secret
 * @param timestamp - The x-orbital-timestamp header value
 * @returns Parsed NormalizedEvent if verification succeeds, null otherwise
 */
export async function verifyWebhookEdge(
  payload: string,
  signature: string,
  secret: string,
  timestamp: string,
): Promise<NormalizedEvent | null> {
  // Validate timestamp format
  if (!/^\d+$/.test(timestamp)) return null;

  try {
    // Import the secret key
    const keyData = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );

    // Create the expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedPayload),
    );

    // Convert expected signature to hex
    const expectedHex = Array.from(new Uint8Array(expectedBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Convert received signature to bytes
    const signatureBytes = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );

    // Constant-time comparison
    const expectedBytes = new Uint8Array(expectedBuffer);
    if (expectedBytes.length !== signatureBytes.length) return null;

    let result = 0;
    for (let i = 0; i < expectedBytes.length; i++) {
      result |= (expectedBytes[i] || 0) ^ (signatureBytes[i] || 0);
    }

    if (result !== 0) return null;

    // Parse the payload
    return JSON.parse(payload) as NormalizedEvent;
  } catch {
    return null;
  }
}
