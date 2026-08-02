import { isIP } from "node:net";

/**
 * A pluggable URL validator for custom block-lists.
 *
 * `WebhookDelivery` has its own SSRF guard (`BLOCKED_WEBHOOK_ADDRESSES` plus a
 * post-DNS re-check) and does not use this class - this is the extension point
 * for consumers who need to add their own rules, and the reference for what
 * "blocked" means. It is exported, so its private-range checks have to be
 * correct rather than illustrative: a consumer who wires this in front of their
 * own fetch is relying on it.
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

    const hostname = this.normalizeHostname(parsedUrl.hostname);

    if (this.isLoopbackHostname(hostname)) {
      return "URL points to a loopback address";
    }

    if (this.isPrivateIp(hostname)) {
      return "URL points to a private IP address";
    }

    const asn = await this.lookupAsn(hostname);
    if (asn && this.blockedAsns.has(asn)) {
      return `URL belongs to a blocked ASN: ${asn}`;
    }

    return null;
  }

  /** Strips IPv6 brackets and lowercases, so checks see a bare address. */
  private normalizeHostname(hostname: string): string {
    return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  }

  private isLoopbackHostname(hostname: string): boolean {
    return hostname === "localhost" || hostname.endsWith(".localhost");
  }

  /**
   * Blocks the address ranges that must never be reachable from a server-side
   * fetch.
   *
   * The list is deliberately explicit: `169.254.0.0/16` is the cloud metadata
   * range and the single most valuable SSRF target, and `127.0.0.0/8` is far
   * wider than the `127.0.0.1` people remember.
   */
  private isPrivateIp(hostname: string): boolean {
    const version = isIP(hostname);

    if (version === 4) {
      const [a, b] = hostname.split(".").map(Number) as [number, number, number, number];

      if (a === 0) return true; // 0.0.0.0/8 - "this network"
      if (a === 10) return true; // 10.0.0.0/8
      if (a === 127) return true; // 127.0.0.0/8 - loopback
      if (a === 169 && b === 254) return true; // 169.254.0.0/16 - link-local / metadata
      if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
      if (a === 192 && b === 168) return true; // 192.168.0.0/16
      if (a === 192 && b === 0) return true; // 192.0.0.0/24 - protocol assignments
      if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 - CGNAT
      if (a >= 224) return true; // multicast and reserved
      return false;
    }

    if (version === 6) {
      if (hostname === "::" || hostname === "::1") return true;
      if (/^f[cd]/.test(hostname)) return true; // fc00::/7 unique-local
      if (/^fe[89ab]/.test(hostname)) return true; // fe80::/10 link-local
      // IPv4-mapped (::ffff:a00:1) and IPv4-compatible forms: re-check the
      // embedded address rather than trusting the textual shape.
      const mapped = /^::(?:ffff:)?([0-9a-f.:]+)$/.exec(hostname);
      const embedded = mapped?.[1] ? this.embeddedIpv4(mapped[1]) : null;
      if (embedded && this.isPrivateIp(embedded)) return true;
      return false;
    }

    // Not an IP literal - a hostname. DNS resolution is the caller's
    // responsibility; `WebhookDelivery` re-checks after resolving, and any
    // consumer using this class directly must do the same.
    return false;
  }

  /** Converts the tail of a mapped IPv6 address to dotted-quad, when it is one. */
  private embeddedIpv4(tail: string): string | null {
    if (isIP(tail) === 4) return tail;

    const hexGroups = tail.split(":").filter((group) => group !== "");
    if (hexGroups.length !== 2) return null;

    const high = Number.parseInt(hexGroups[0]!, 16);
    const low = Number.parseInt(hexGroups[1]!, 16);
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;

    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
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
