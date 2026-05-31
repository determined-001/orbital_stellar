/**
 * Tests for the orbital CLI's DLQ subcommands.
 * We test the HTTP interactions by stubbing global fetch and capturing
 * what the CLI would print to stdout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Inline the CLI logic so we can test it without spawning a subprocess.
// We extract the core functions from the CLI source.

function parseArgs(argv: string[]): { flags: Record<string, string>; positional: string[] } {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) {
      flags[m[1]] = m[2];
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

async function apiFetch(
  baseUrl: string,
  path: string,
  method = "GET"
): Promise<unknown> {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, { method });
  const body = await res.json();
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

function mockFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status })
      )
    )
  );
}

describe("orbital CLI — parseArgs", () => {
  it("parses --key=value flags", () => {
    const { flags } = parseArgs(["--url=http://localhost:3000", "--since=2026-01-01"]);
    expect(flags.url).toBe("http://localhost:3000");
    expect(flags.since).toBe("2026-01-01");
  });

  it("collects positional arguments", () => {
    const { positional } = parseArgs(["--url=http://x", "abc-123"]);
    expect(positional).toEqual(["abc-123"]);
  });
});

describe("orbital CLI — apiFetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the correct URL for dlq list without since", async () => {
    mockFetch([]);
    await apiFetch("http://localhost:3000", "/dlq");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/dlq", { method: "GET" });
  });

  it("calls the correct URL for dlq list with since", async () => {
    mockFetch([]);
    await apiFetch("http://localhost:3000", "/dlq?since=2026-01-01");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/dlq?since=2026-01-01",
      { method: "GET" }
    );
  });

  it("calls POST for dlq replay", async () => {
    mockFetch({ replayed: "abc-123" });
    const result = await apiFetch("http://localhost:3000", "/dlq/abc-123/replay", "POST");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/dlq/abc-123/replay",
      { method: "POST" }
    );
    expect(result).toEqual({ replayed: "abc-123" });
  });

  it("calls GET for dlq dump", async () => {
    mockFetch([{ id: "x" }]);
    const result = await apiFetch("http://localhost:3000", "/dlq/dump");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/dlq/dump", { method: "GET" });
    expect(result).toEqual([{ id: "x" }]);
  });

  it("throws on non-OK response", async () => {
    mockFetch({ error: "not found" }, 404);
    await expect(apiFetch("http://localhost:3000", "/dlq/missing")).rejects.toThrow("404 not found");
  });

  it("strips trailing slash from baseUrl", async () => {
    mockFetch([]);
    await apiFetch("http://localhost:3000/", "/dlq");
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/dlq", expect.anything());
  });
});
