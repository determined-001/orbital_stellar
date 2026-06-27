/**
 * A pluggable URL validator for custom block-lists.
 * This is an example implementation that blocks private IP ranges and a list of known-bad ASNs.
 */
export class UrlValidator {
  private readonly blockedAsns: Set<string>;

  constructor(blockedAsns: string[] = []) {
    this.blockedAsns = new Set(blockedAsns);
  }

  /**
   * Validates the URL against built-in rules and custom block-lists.
   * @param url The URL to validate.
   * @returns An error message if the URL is rejected, or null if it is allowed.
   */
  async validate(url: string): Promise<string | null> {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;

      // 1. Built-in check: Block private IP ranges
      if (this.isPrivateIp(hostname)) {
        return "URL points to a private IP address";
      }

      // 2. Custom check: Block known-bad ASNs
      const asn = await this.lookupAsn(hostname);
      if (asn && this.blockedAsns.has(asn)) {
        return `URL belongs to a blocked ASN: ${asn}`;
      }

      return null;
    } catch {
      return "Invalid URL format";
    }
  }

  private isPrivateIp(hostname: string): boolean {
    // Simple regex check for private IP ranges (IPv4)
    const privateIpRegex = /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)/;
    return privateIpRegex.test(hostname);
  }

  private async lookupAsn(hostname: string): Promise<string | null> {
    try {
      // Example using a public API for ASN lookup. In production, use a cached local database.
      const response = await fetch(`https://rdap.db.ripe.net/autnum/lookup?hostname=${hostname}`);
      if (!response.ok) return null;

      const data = await response.json();
      // This is a simplified extraction; actual RDAP response structure varies.
      return data.asn || null;
    } catch {
      return null;
    }
  }
}
