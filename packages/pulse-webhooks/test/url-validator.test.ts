import { describe, expect, it, vi, afterEach } from "vitest";
import { UrlValidator } from "../src/url-validator.js";

const validator = new UrlValidator();

afterEach(() => {
  vi.restoreAllMocks();
});

/** ASN lookup is a network call; stub it so these tests stay offline. */
function withoutAsnLookup(): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("UrlValidator SSRF rules (#926)", () => {
  it("allows an ordinary public https URL", async () => {
    withoutAsnLookup();
    expect(await validator.validate("https://hooks.example.com/orbital")).toBeNull();
  });

  it.each([
    ["file:///etc/passwd", /scheme file: is not allowed/],
    ["gopher://example.com/", /scheme gopher: is not allowed/],
    ["data:text/plain,hello", /scheme data: is not allowed/],
  ])("rejects %s", async (url, expected) => {
    await expect(validator.validate(url)).resolves.toMatch(expected);
  });

  it("rejects credentials embedded in the URL", async () => {
    await expect(validator.validate("https://user:pass@example.com/hook")).resolves.toMatch(
      /must not contain credentials/,
    );
  });

  it.each([
    "http://localhost/hook",
    "http://LOCALHOST/hook",
    "http://api.localhost/hook",
    "http://127.0.0.1/hook",
    "http://127.1.2.3/hook",
    "http://[::1]/hook",
  ])("rejects loopback target %s", async (url) => {
    expect(await validator.validate(url)).not.toBeNull();
  });

  it.each([
    ["http://10.0.0.1/hook", "10.0.0.0/8"],
    ["http://172.16.5.4/hook", "172.16.0.0/12"],
    ["http://172.31.255.255/hook", "172.16.0.0/12 upper bound"],
    ["http://192.168.1.1/hook", "192.168.0.0/16"],
    ["http://169.254.169.254/hook", "cloud metadata"],
    ["http://0.0.0.0/hook", "0.0.0.0/8"],
    ["http://100.64.0.1/hook", "CGNAT"],
    ["http://192.0.0.1/hook", "IETF protocol assignments"],
    ["http://239.255.255.250/hook", "multicast"],
  ])("rejects %s (%s)", async (url) => {
    await expect(validator.validate(url)).resolves.toMatch(/private IP address/);
  });

  it.each([
    ["http://[fc00::1]/hook", "unique-local"],
    ["http://[fe80::1]/hook", "link-local"],
    ["http://[::]/hook", "unspecified"],
    ["http://[::ffff:10.0.0.1]/hook", "IPv4-mapped private"],
    ["http://[::ffff:a9fe:a9fe]/hook", "IPv4-mapped metadata in hex"],
  ])("rejects IPv6 %s (%s)", async (url) => {
    expect(await validator.validate(url)).not.toBeNull();
  });

  it("does not reject a public address that merely starts with a blocked digit", async () => {
    withoutAsnLookup();
    // 172.15 and 172.32 sit outside 172.16.0.0/12; 100.63 outside CGNAT.
    expect(await validator.validate("http://172.15.0.1/hook")).toBeNull();
    expect(await validator.validate("http://172.32.0.1/hook")).toBeNull();
    expect(await validator.validate("http://100.63.0.1/hook")).toBeNull();
  });

  it("rejects a malformed URL", async () => {
    await expect(validator.validate("not a url")).resolves.toBe("Invalid URL format");
  });

  it("blocks a configured ASN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ asn: "AS64512" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      new UrlValidator(["AS64512"]).validate("https://hooks.example.com/orbital"),
    ).resolves.toMatch(/blocked ASN/);
  });

  it("allows the URL when the ASN lookup fails - it is advisory, not a gate", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    expect(await new UrlValidator(["AS64512"]).validate("https://hooks.example.com/x")).toBeNull();
  });
});
