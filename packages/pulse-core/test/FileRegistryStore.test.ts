import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FileRegistryStore } from "../src/FileRegistryStore.js";
import fs from "fs";
import path from "path";
import os from "os";

const mkdtemp = (prefix = "fileregistry-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

describe("FileRegistryStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtemp();
    filePath = path.join(dir, "registry.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });

  it("registers and retrieves URLs for an address", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://hook.example.com/1"]);
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("returns empty array for unregistered address", async () => {
    const store = new FileRegistryStore(filePath);
    expect(await store.get("GXYZ")).toEqual([]);
  });

  it("replaces existing URLs on re-register", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://old.example.com"]);
    await store.register("GABC", ["https://new.example.com"]);
    expect(await store.get("GABC")).toEqual(["https://new.example.com"]);
  });

  it("deregisters an address", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://hook.example.com/1"]);
    await store.deregister("GABC");
    expect(await store.get("GABC")).toEqual([]);
  });

  it("deregister is a no-op for unknown address", async () => {
    const store = new FileRegistryStore(filePath);
    await expect(store.deregister("GXYZ")).resolves.toBeUndefined();
  });

  it("lists all registrations", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://a.example.com"]);
    await store.register("GDEF", ["https://b.example.com", "https://c.example.com"]);
    expect(await store.list()).toEqual({
      GABC: ["https://a.example.com"],
      GDEF: ["https://b.example.com", "https://c.example.com"],
    });
  });

  it("list returns empty object when nothing registered", async () => {
    const store = new FileRegistryStore(filePath);
    expect(await store.list()).toEqual({});
  });

  it("round-trips registrations across instances (survives restart)", async () => {
    const store1 = new FileRegistryStore(filePath);
    await store1.register("GABC", ["https://hook.example.com/1"]);
    await store1.register("GDEF", ["https://hook.example.com/2"]);

    const store2 = new FileRegistryStore(filePath);
    expect(await store2.get("GABC")).toEqual(["https://hook.example.com/1"]);
    expect(await store2.get("GDEF")).toEqual(["https://hook.example.com/2"]);
  });

  it("persists deregister across instances", async () => {
    const store1 = new FileRegistryStore(filePath);
    await store1.register("GABC", ["https://hook.example.com/1"]);
    await store1.deregister("GABC");

    const store2 = new FileRegistryStore(filePath);
    expect(await store2.get("GABC")).toEqual([]);
  });

  it("returns empty array and warns on corrupt file", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, "{ not valid json", "utf8");

    const store = new FileRegistryStore(filePath, logger);
    expect(await store.get("GABC")).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to parse"),
      expect.objectContaining({ file: filePath }),
    );
  });

  it("returns empty and warns on unexpected JSON shape", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    fs.writeFileSync(filePath, JSON.stringify([1, 2, 3]), "utf8");

    const store = new FileRegistryStore(filePath, logger);
    expect(await store.get("GABC")).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("unexpected JSON shape"),
      expect.objectContaining({ file: filePath }),
    );
  });

  it("creates parent directory if it does not exist", async () => {
    const nestedPath = path.join(dir, "nested", "deep", "registry.json");
    const store = new FileRegistryStore(nestedPath);
    await store.register("GABC", ["https://hook.example.com/1"]);
    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it("returns defensive copies from get", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://hook.example.com/1"]);
    const result = await store.get("GABC");
    result.push("https://intruder.example.com");
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("returns defensive copies from list", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://hook.example.com/1"]);
    const listing = await store.list();
    listing["GABC"].push("https://intruder.example.com");
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("supports multiple URLs per address", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://hook.example.com/1", "https://hook.example.com/2"]);
    expect(await store.get("GABC")).toEqual([
      "https://hook.example.com/1",
      "https://hook.example.com/2",
    ]);
  });

  it("independent registrations do not interfere", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://a.example.com"]);
    await store.register("GDEF", ["https://b.example.com"]);
    await store.deregister("GABC");
    expect(await store.get("GDEF")).toEqual(["https://b.example.com"]);
  });

  it("uses atomic write (.tmp then rename)", async () => {
    const store = new FileRegistryStore(filePath);
    await store.register("GABC", ["https://hook.example.com/1"]);
    const files = fs.readdirSync(dir);
    expect(files.every((f) => !f.endsWith(".tmp"))).toBe(true);
    expect(files).toContain("registry.json");
  });
});
