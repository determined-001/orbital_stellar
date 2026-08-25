import { isLoopbackHostname, isPrivateIpLiteral, normalizeHostname } from "./private-ip.js";

/**
 * A pluggable URL validator for custom block-lists.
 *
 * This is the extension point for consumers who need to add their own rules on
 * top of the built-in SSRF guard - ASN block-lists, allow-lists, and so on.
 *
 * It shares its address checks with `WebhookDelivery` via `./private-ip.js`.
 * They used to be separate implementations, which is how the delivery path
 * ended up the weaker of the two; keep new rules in the shared module unless
 * they are genuinely specific to one caller.
 *
 * Reviewed for #926.
 */
export class UrlValidator {
  private readonly blockedAsns: Set<string>;

  constructor(blockedAsns: string[] = []) {
    this.blockedAsns = new Set(blockedAsns);
  }

  /**
   * Validates the URL against built-in rules and custom block-lists.
   *
   * @param url The URL to validate.
   * @returns An error message if the URL is rejected, or null if it is allowed.
   */
  async validate(url: string): Promise<string | null> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return "Invalid URL format";
    }

    // Only http(s). file:, gopher: and data: are never a webhook target, and
    // some fetch implementations will happily follow them.
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return `URL scheme ${parsedUrl.protocol} is not allowed`;
    }

    // Credentials in the URL are a redirect-laundering trick with no
    // legitimate use in a webhook target.
    if (parsedUrl.username !== "" || parsedUrl.password !== "") {
      return "URL must not contain credentials";
    }

    const hostname = normalizeHostname(parsedUrl.hostname);

    if (isLoopbackHostname(hostname)) {
      return "URL points to a loopback address";
    }

    if (isPrivateIpLiteral(hostname)) {
      return "URL points to a private IP address";
    }

    const asn = await this.lookupAsn(hostname);
    if (asn && this.blockedAsns.has(asn)) {
      return `URL belongs to a blocked ASN: ${asn}`;
    }

    return null;
  }

  private async lookupAsn(hostname: string): Promise<string | null> {
    try {
      // Example using a public API for ASN lookup. In production, use a cached
      // local database - a network call per validation is a DoS lever.
      const response = await fetch(
        `https://rdap.db.ripe.net/autnum/lookup?hostname=${encodeURIComponent(hostname)}`,
      );
      if (!response.ok) return null;

      const data = (await response.json()) as { asn?: string };
      return data.asn ?? null;
    } catch {
      return null;
    }
  }
}
