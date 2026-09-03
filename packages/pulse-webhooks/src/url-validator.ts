import { isLoopbackHostname, isPrivateIpLiteral, normalizeHostname } from "./private-ip.js";

/**
 * A pluggable URL validator for custom block-lists.
 *
 * This is the extension point for consumers who need to add their own rules on
 * top of the built-in SSRF guard - allow-lists, custom domain block-lists, and
 * so on. It shares its address checks with `WebhookDelivery` via
 * `./private-ip.js`. They used to be separate implementations, which is how the
 * delivery path ended up the weaker of the two; keep new rules in the shared
 * module unless they are genuinely specific to one caller.
 *
 * Reviewed for #926.
 *
 * ### ASN blocking is intentionally not provided
 *
 * A previous version accepted `blockedAsns` and resolved the target's ASN via a
 * per-validation network call to RIPE's RDAP autnum endpoint. That endpoint
 * takes an autonomous-system number, not a hostname, so the lookup could never
 * succeed - every URL was silently allowed while the control *appeared* active
 * (see #1029). A control that fails open is worse than no control: it displaces
 * the effort someone would otherwise spend on a real one.
 *
 * ASN blocking was therefore removed. The constructor now **throws** if you pass
 * a non-empty `blockedAsns`, so an operator relying on the (absent) control
 * finds out immediately instead of shipping a no-op. If you need ASN blocking,
 * implement it against a *cached local* ASN dataset (never a network call per
 * validation - that is its own denial-of-service lever) in your own validator
 * and pass that function as `WebhookConfig.urlValidator`.
 */
export class UrlValidator {
  constructor(blockedAsns: string[] = []) {
    if (blockedAsns.length > 0) {
      throw new Error(
        "UrlValidator no longer supports blockedAsns (ASN blocking). The previous " +
          "implementation silently allowed every URL because the RDAP autnum lookup could " +
          "never resolve a hostname (see issue #1029), so the control was not actually " +
          "enforced. ASN blocking is not provided by this package. If you need it, implement " +
          "it against a cached local ASN dataset in your own validator and pass that as " +
          "WebhookConfig.urlValidator - do not rely on a built-in that is absent.",
      );
    }
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

    return null;
  }
}
