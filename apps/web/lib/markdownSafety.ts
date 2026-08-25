import type { RendererObject } from "marked";

/**
 * Shared hardening for every markdown surface rendered through
 * `dangerouslySetInnerHTML`.
 *
 * The content is repo markdown, not visitor input, so nothing here is remotely
 * triggerable. It is still worth doing: this repo merges contributor markdown
 * at volume, docs changes attract the least review of any diff, and
 * `marked`'s defaults pass raw HTML straight through. Extracted from
 * `reference.ts` so `docs.ts` cannot drift from it - the two renderers being
 * out of step is exactly how one of them ended up unprotected.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// http(s)/mailto only - blocks javascript:, data:, vbscript:, etc. Relative/anchor URLs
// (no scheme) are also allowed.
export function isSafeUrl(url: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) || /^(https?|mailto):/i.test(url);
}

/**
 * Builds a renderer that escapes raw HTML instead of emitting it and
 * scheme-checks every link and image URL. Manually verified against
 * `<script>`, `onerror=`, and `javascript:` payloads.
 *
 * Must be a plain object, not a class extending Renderer - marked's `Marked.use()` merges
 * overrides via `for...in`, which only sees own enumerable properties; class methods on a
 * prototype are non-enumerable and get silently ignored.
 *
 * @param resolveLink - Optional rewrite for internal links (the reference
 *   section maps `.md` paths onto routes). Defaults to leaving hrefs alone.
 */
export function createSafeRenderer(
  resolveLink: (href: string) => string = (href) => href,
): RendererObject {
  return {
    html(token) {
      return escapeHtml(token.text);
    },

    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!isSafeUrl(href)) return text;
      const resolved = resolveLink(href);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(resolved)}"${titleAttr}>${text}</a>`;
    },

    image({ href, title, text }) {
      if (!isSafeUrl(href)) return escapeHtml(text);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr}>`;
    },
  };
}
