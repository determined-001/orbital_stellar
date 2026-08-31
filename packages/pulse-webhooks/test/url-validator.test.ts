import { describe, expect, it } from "vitest";
import { UrlValidator } from "../src/url-validator.js";

describe("UrlValidator SSRF rules (#926)", () => {
  it("allows an ordinary public https URL", async () => {
    expect(await new UrlValidator().validate("https://hooks.example.com/orbital")).toBeNull();
  });

  it.each([
    ["file:///etc/passwd", /scheme file: is not allowed/],
    ["gopher://example.com/", /scheme gopher: is not allowed/],
    ["data:text/plain,hello", /scheme data: is not allowed/],
  ])("rejects %s", async (url, expected) => {
    await expect(new UrlValidator().validate(url)).resolves.toMatch(expected);
  });

  it("rejects credentials embedded in the URL", async () => {
    await expect(
      new UrlValidator().validate("https://user:pass@example.com/hook"),
    ).resolves.toMatch(/must not contain credentials/);
  });

  it.each([
    "http://localhost/hook",
    "http://LOCALHOST/hook",
    "http://api.localhost/hook",
    "http://127.0.0.1/hook",
    "http://127.1.2.3/hook",
    "http://[::1]/hook",
  ])("rejects loopback target %s", async (url) => {
    expect(await new UrlValidator().validate(url)).not.toBeNull();
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
    await expect(new UrlValidator().validate(url)).resolves.toMatch(/private IP address/);
  });

  it.each([
    ["http://[fc00::1]/hook", "unique-local"],
    ["http://[fe80::1]/hook", "link-local"],
    ["http://[::]/hook", "unspecified"],
    ["http://[::ffff:10.0.0.1]/hook", "IPv4-mapped private"],
    ["http://[::ffff:a9fe:a9fe]/hook", "IPv4-mapped metadata in hex"],
  ])("rejects IPv6 %s (%s)", async (url) => {
    expect(await new UrlValidator().validate(url)).not.toBeNull();
  });

  it("does not reject a public address that merely starts with a blocked digit", async () => {
    // 172.15 and 172.32 sit outside 172.16.0.0/12; 100.63 outside CGNAT.
    expect(await new UrlValidator().validate("http://172.15.0.1/hook")).toBeNull();
    expect(await new UrlValidator().validate("http://172.32.0.1/hook")).toBeNull();
    expect(await new UrlValidator().validate("http://100.63.0.1/hook")).toBeNull();
  });

  it("rejects a malformed URL", async () => {
    await expect(new UrlValidator().validate("not a url")).resolves.toBe("Invalid URL format");
  });
});

describe("UrlValidator ASN blocking (#1029)", () => {
  it("throws when blockedAsns is supplied, so operators relying on the absent control find out immediately", () => {
    expect(() => new UrlValidator(["AS64512"])).toThrow(/blockedAsns/);
    expect(() => new UrlValidator(["AS64512", "AS15169"])).toThrow(/not.*enforced/i);
  });

  it("constructs without error when no blockedAsns is supplied", () => {
    expect(() => new UrlValidator()).not.toThrow();
    expect(() => new UrlValidator([])).not.toThrow();
  });

  it("does not perform any network lookup and never fails open on ASN", async () => {
    const validator = new UrlValidator();
    // No fetch is attempted; a public URL is allowed, a private one is blocked.
    await expect(validator.validate("https://hooks.example.com/orbital")).resolves.toBeNull();
    await expect(validator.validate("http://10.0.0.1/hook")).resolves.toMatch(/private IP address/);
  });
});
