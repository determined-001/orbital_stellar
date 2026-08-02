import { z } from "zod";
import { stripInlineComment, stripScheme, stripTrailingSlashes } from "./strings.js";

/**
 * SEP-1 discovery: fetch and parse the anchor's `stellar.toml` to learn which
 * endpoints it exposes, instead of making the caller hardcode them.
 *
 * Only the fields the rest of this SDK needs are parsed. A TOML value that is
 * present but not a string is treated as absent rather than coerced - a bad
 * `stellar.toml` should fail loudly at use, not silently produce a URL like
 * "undefined/transactions".
 */

/** Thrown when the anchor's `stellar.toml` cannot be fetched or parsed. */
export class Sep1DiscoveryError extends Error {
  constructor(reason: string) {
    super(`[anchor-sdk] SEP-1 discovery failed: ${reason}`);
    this.name = "Sep1DiscoveryError";
  }
}

export const StellarTomlSchema = z.object({
  /** SEP-10 authentication endpoint. */
  WEB_AUTH_ENDPOINT: z.string().optional(),
  /** SEP-24 interactive deposit/withdrawal endpoint. */
  TRANSFER_SERVER_SEP0024: z.string().optional(),
  /** SEP-31 cross-border payment endpoint. */
  DIRECT_PAYMENT_SERVER: z.string().optional(),
  /** SEP-12 customer registry endpoint. */
  KYC_SERVER: z.string().optional(),
  /** The account SEP-10 challenges are signed by. */
  SIGNING_KEY: z.string().optional(),
  /** Network the anchor operates on. */
  NETWORK_PASSPHRASE: z.string().optional(),
});

export type StellarToml = z.infer<typeof StellarTomlSchema>;

export type Sep1Options = {
  /** Transport override; defaults to the global `fetch`. */
  transport?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Request timeout in milliseconds. Defaults to 10 000. */
  timeoutMs?: number;
};

const KEYS_OF_INTEREST = new Set(Object.keys(StellarTomlSchema.shape));

/**
 * Minimal TOML reader for the flat top-level `KEY = "value"` pairs SEP-1
 * requires. It deliberately does not implement TOML: everything this SDK reads
 * is a top-level string, and pulling a parser in for that would add a
 * dependency to a package whose whole point is being small.
 *
 * Table headers (`[[CURRENCIES]]`) end top-level scanning, which is exactly
 * the semantics we want - keys inside a table are not the endpoints.
 */
export function parseStellarToml(toml: string): StellarToml {
  const values: Record<string, string> = {};

  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("[")) break;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    if (!KEYS_OF_INTEREST.has(key)) continue;

    const value = stripInlineComment(line.slice(separator + 1).trim());

    const unquoted = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value);
    if (!unquoted) continue;

    values[key] = unquoted[1]!;
  }

  return StellarTomlSchema.parse(values);
}

/**
 * Fetches `https://{homeDomain}/.well-known/stellar.toml` and returns the
 * endpoints this SDK understands.
 *
 * @param homeDomain Anchor home domain, with or without a scheme.
 * @throws {Sep1DiscoveryError} on a non-2xx response, a timeout, or a body
 *   that does not parse.
 */
export async function discoverAnchor(
  homeDomain: string,
  options: Sep1Options = {},
): Promise<StellarToml> {
  const transport = options.transport ?? fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 10_000;

  const host = stripTrailingSlashes(stripScheme(homeDomain));
  if (host === "") {
    throw new Sep1DiscoveryError("home domain is empty");
  }
  const url = `https://${host}/.well-known/stellar.toml`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await transport(url, { signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Sep1DiscoveryError(`could not reach ${url} (${reason})`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Sep1DiscoveryError(`${url} returned ${response.status}`);
  }

  try {
    return parseStellarToml(await response.text());
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Sep1DiscoveryError(`${url} is not a usable stellar.toml (${reason})`);
  }
}
