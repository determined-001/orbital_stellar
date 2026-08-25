import { describe, it, expect } from "vitest";
import { Marked } from "marked";
import { createSafeRenderer, escapeHtml, isSafeUrl } from "@/lib/markdownSafety";

/** Renders markdown exactly as lib/docs.ts does. */
function render(markdown: string): string {
  const marked = new Marked({ renderer: createSafeRenderer() });
  return marked.parse(markdown, { gfm: true, async: false }) as string;
}

describe("escapeHtml", () => {
  it("escapes the characters that break out of markup", () => {
    expect(escapeHtml(`<script>"&"</script>`)).toBe(
      "&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;",
    );
  });

  it("escapes ampersands before the entities it introduces", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("isSafeUrl", () => {
  it("allows http, https, mailto, relative and anchor URLs", () => {
    for (const url of [
      "https://example.com",
      "http://example.com",
      "mailto:a@b.c",
      "/docs/guides/webhooks",
      "./sibling.md",
      "#section",
    ]) {
      expect(isSafeUrl(url), url).toBe(true);
    }
  });

  it("blocks script-bearing schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
    ]) {
      expect(isSafeUrl(url), url).toBe(false);
    }
  });
});

describe("safe renderer (MEDIUM-5 regression)", () => {
  // Docs content is repo markdown, but this repo merges contributor docs PRs
  // at volume and docs diffs get the least scrutiny. The output here goes
  // straight into dangerouslySetInnerHTML.
  it("escapes an inline <script> instead of emitting it", () => {
    const html = render(`# Title\n\n<script>alert(1)</script>\n`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an onerror image payload", () => {
    const html = render(`<img src=x onerror="alert(1)">`);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain("&lt;img");
  });

  it("strips a javascript: link but keeps its text", () => {
    const html = render(`[click me](javascript:alert(1))`);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
  });

  it("strips a data: image but keeps its alt text", () => {
    const html = render(`![alt text](data:text/html;base64,PHNjcmlwdD4=)`);
    expect(html).not.toContain("data:text/html");
    expect(html).toContain("alt text");
  });

  it("escapes raw HTML embedded mid-paragraph", () => {
    const html = render(`Normal text <iframe src="https://evil.example"></iframe> more text.`);
    expect(html).not.toContain("<iframe");
    expect(html).toContain("&lt;iframe");
  });

  it("still renders ordinary markdown", () => {
    const html = render(
      ["# Heading", "", "Some **bold** text and `code`.", "", "- item one", "- item two"].join(
        "\n",
      ),
    );
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>item one</li>");
  });

  it("keeps safe links and images working", () => {
    expect(render(`[docs](/docs/guides/webhooks)`)).toContain(
      `<a href="/docs/guides/webhooks">docs</a>`,
    );
    expect(render(`![logo](https://example.com/logo.png)`)).toContain(
      `<img src="https://example.com/logo.png" alt="logo">`,
    );
  });

  it("applies a caller-supplied link resolver only to safe URLs", () => {
    const marked = new Marked({
      renderer: createSafeRenderer((href) => `/reference/${href}`),
    });
    const html = marked.parse(`[a](sibling.md) [b](javascript:alert(1))`, {
      gfm: true,
      async: false,
    }) as string;

    expect(html).toContain(`href="/reference/sibling.md"`);
    expect(html).not.toContain("javascript:");
  });
});
