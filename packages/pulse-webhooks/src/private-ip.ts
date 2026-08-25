import { isIP } from "node:net";

/**
 * The single definition of "an address a server-side fetch must never reach".
 *
 * This used to exist twice: as a `net.BlockList` inside `WebhookDelivery` and
 * as `UrlValidator.isPrivateIp`. The two drifted, and the copy that actually
 * guards outbound deliveries was the weaker one - it omitted `0.0.0.0/8`, the
 * IPv6 unspecified address, CGNAT and `192.0.0.0/24`. Since those are IP
 * literals, the post-DNS re-check skipped them too, so `http://0.0.0.0:8080/`
 * passed validation and reached a service bound to loopback on Linux.
 *
 * One exported function, used by both, so there is nothing left to drift.
 */

/**
 * Whether `hostname` is an IP literal in a range that must not be reachable.
 *
 * Returns `false` for anything that is not an IP literal - a DNS name has to be
 * resolved first and each answer checked, which is the caller's job
 * (`WebhookDelivery.validateResolvedHostname` does this before every attempt).
 *
 * The ranges are deliberately explicit rather than clever: `169.254.0.0/16` is
 * the cloud metadata range and the single most valuable SSRF target, and
 * `127.0.0.0/8` is far wider than the `127.0.0.1` people remember.
 */
export function isPrivateIpLiteral(hostname: string): boolean {
  const version = isIP(hostname);

  if (version === 4) {
    const [a, b] = hostname.split(".").map(Number) as [number, number, number, number];

    if (a === 0) return true; // 0.0.0.0/8 - "this network"; 0.0.0.0 routes to loopback on Linux
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 - loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 - link-local / cloud metadata
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
    const embedded = mapped?.[1] ? embeddedIpv4(mapped[1]) : null;
    if (embedded && isPrivateIpLiteral(embedded)) return true;
    return false;
  }

  return false;
}

/**
 * Whether `hostname` names the local machine by name rather than by address.
 *
 * `.localhost` is reserved by RFC 6761 and resolvers are expected to answer it
 * with a loopback address, so the suffix has to be covered and not just the
 * bare label.
 */
export function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

/** Strips IPv6 brackets and lowercases, so the checks above see a bare address. */
export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

/**
 * Whether `hostname` is already an IP address rather than a name needing DNS.
 *
 * Callers use this to decide whether a post-resolution re-check is required at
 * all: a literal was checked directly by `isPrivateIpLiteral`, so there is
 * nothing left to resolve.
 */
export function isIpLiteral(hostname: string): boolean {
  return isIP(hostname) !== 0;
}

/** Converts the tail of a mapped IPv6 address to dotted-quad, when it is one. */
function embeddedIpv4(tail: string): string | null {
  if (isIP(tail) === 4) return tail;

  const hexGroups = tail.split(":").filter((group) => group !== "");
  if (hexGroups.length !== 2) return null;

  const high = Number.parseInt(hexGroups[0]!, 16);
  const low = Number.parseInt(hexGroups[1]!, 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return null;

  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}
