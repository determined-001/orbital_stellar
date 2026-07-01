import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRegistryStore } from "../src/IRegistryStore.js";

describe("InMemoryRegistryStore", () => {
  let store: InMemoryRegistryStore;

  beforeEach(() => {
    store = new InMemoryRegistryStore();
  });

  it("registers and retrieves URLs for an address", async () => {
    await store.register("GABC", ["https://hook.example.com/1"]);
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("returns empty array for unregistered address", async () => {
    expect(await store.get("GXYZ")).toEqual([]);
  });

  it("replaces existing URLs on re-register", async () => {
    await store.register("GABC", ["https://old.example.com"]);
    await store.register("GABC", ["https://new.example.com"]);
    expect(await store.get("GABC")).toEqual(["https://new.example.com"]);
  });

  it("deregisters an address", async () => {
    await store.register("GABC", ["https://hook.example.com/1"]);
    await store.deregister("GABC");
    expect(await store.get("GABC")).toEqual([]);
  });

  it("deregister is a no-op for unknown address", async () => {
    await expect(store.deregister("GXYZ")).resolves.toBeUndefined();
  });

  it("lists all registrations", async () => {
    await store.register("GABC", ["https://a.example.com"]);
    await store.register("GDEF", ["https://b.example.com", "https://c.example.com"]);
    expect(await store.list()).toEqual({
      GABC: ["https://a.example.com"],
      GDEF: ["https://b.example.com", "https://c.example.com"],
    });
  });

  it("list returns empty object when nothing registered", async () => {
    expect(await store.list()).toEqual({});
  });

  it("register stores a defensive copy of the urls array", async () => {
    const urls = ["https://hook.example.com/1"];
    await store.register("GABC", urls);
    urls.push("https://hook.example.com/2");
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("get returns a defensive copy", async () => {
    await store.register("GABC", ["https://hook.example.com/1"]);
    const result = await store.get("GABC");
    result.push("https://intruder.example.com");
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("list returns defensive copies", async () => {
    await store.register("GABC", ["https://hook.example.com/1"]);
    const listing = await store.list();
    listing["GABC"].push("https://intruder.example.com");
    expect(await store.get("GABC")).toEqual(["https://hook.example.com/1"]);
  });

  it("supports multiple URLs per address", async () => {
    await store.register("GABC", ["https://hook.example.com/1", "https://hook.example.com/2"]);
    expect(await store.get("GABC")).toEqual([
      "https://hook.example.com/1",
      "https://hook.example.com/2",
    ]);
  });

  it("independent registrations do not interfere", async () => {
    await store.register("GABC", ["https://a.example.com"]);
    await store.register("GDEF", ["https://b.example.com"]);
    await store.deregister("GABC");
    expect(await store.get("GDEF")).toEqual(["https://b.example.com"]);
  });
});
