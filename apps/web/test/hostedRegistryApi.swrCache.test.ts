import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SwrCache } from "@/lib/hostedRegistryApi";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SwrCache", () => {
  it("calls the fetcher and returns a fresh (non-stale) value on first get", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValue(1);

    const result = await cache.get(fetcher);

    expect(result).toEqual({ value: 1, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves the cached value without calling the fetcher again within the fresh TTL", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValue(1);

    await cache.get(fetcher);
    vi.advanceTimersByTime(999);
    const result = await cache.get(fetcher);

    expect(result).toEqual({ value: 1, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves the stale value (marked stale) and kicks off a background refresh past the TTL but within the stale window", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await cache.get(fetcher);
    vi.advanceTimersByTime(1500);
    const result = await cache.get(fetcher);

    // The caller gets the stale value immediately, explicitly marked -
    // never a silent stale response.
    expect(result).toEqual({ value: 1, stale: true });
    // The background refresh was kicked off (fetcher called a 2nd time)
    // without the caller having to await it.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not kick off a second background refresh while one is already in flight", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    let resolveSecond!: (v: number) => void;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockReturnValueOnce(new Promise<number>((r) => (resolveSecond = r)));

    await cache.get(fetcher);
    vi.advanceTimersByTime(1500);
    await cache.get(fetcher); // triggers the in-flight refresh
    const result = await cache.get(fetcher); // should not trigger a second one

    expect(result).toEqual({ value: 1, stale: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    resolveSecond(2);
  });

  it("serves the refreshed value once the background refresh completes", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await cache.get(fetcher);
    vi.advanceTimersByTime(1500);
    await cache.get(fetcher); // stale response, refresh kicked off
    // Let the in-flight background refresh's microtasks/promises settle.
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    const result = await cache.get(fetcher);
    expect(result).toEqual({ value: 2, stale: false });
  });

  it("blocks on a fresh fetch once past both the TTL and the stale window", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await cache.get(fetcher);
    vi.advanceTimersByTime(5001);
    const result = await cache.get(fetcher);

    expect(result).toEqual({ value: 2, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps serving the last good value (still stale) when a background refresh fails", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await cache.get(fetcher);
    vi.advanceTimersByTime(1500);
    await cache.get(fetcher); // triggers the failing background refresh
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

    const result = await cache.get(fetcher);
    expect(result).toEqual({ value: 1, stale: true });
    errorSpy.mockRestore();
  });

  it("clear() forces the next get() to treat the cache as empty", async () => {
    const cache = new SwrCache<number>(1000, 4000);
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await cache.get(fetcher);
    cache.clear();
    const result = await cache.get(fetcher);

    expect(result).toEqual({ value: 2, stale: false });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
