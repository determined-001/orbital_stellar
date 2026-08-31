// A minimal in-memory stand-in for @upstash/redis, covering only the
// commands demo-limits.ts and fireEventRateLimit.ts actually call
// (incr/decr/expire/del/set/pttl). `fakeRedisStore` is process-wide (module
// singleton) so tests can simulate "a different serverless instance" by
// resetting the SUT's cached client (`__resetUpstashRedisForTests`) while the
// backing data survives — exactly like a real shared Redis would.

type Entry = { value: string; expiresAt: number | null };

class FakeRedisStore {
  private data = new Map<string, Entry>();

  private read(key: string): Entry | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry;
  }

  incr(key: string): number {
    const entry = this.read(key);
    const next = (entry ? Number(entry.value) : 0) + 1;
    this.data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  decr(key: string): number {
    const entry = this.read(key);
    const next = (entry ? Number(entry.value) : 0) - 1;
    this.data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }

  expire(key: string, seconds: number): number {
    const entry = this.read(key);
    if (!entry) return 0;
    entry.expiresAt = Date.now() + seconds * 1000;
    return 1;
  }

  del(key: string): number {
    return this.data.delete(key) ? 1 : 0;
  }

  set(key: string, value: string, opts?: { nx?: boolean; px?: number }): "OK" | null {
    if (opts?.nx && this.read(key)) return null;
    const expiresAt = opts?.px ? Date.now() + opts.px : null;
    this.data.set(key, { value, expiresAt });
    return "OK";
  }

  pttl(key: string): number {
    const entry = this.read(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(0, entry.expiresAt - Date.now());
  }

  /** Test helper — wipes all keys between test cases. */
  reset(): void {
    this.data.clear();
  }

  /** Test helper — inspect a raw value, e.g. to assert a counter's state. */
  peek(key: string): string | undefined {
    return this.read(key)?.value;
  }
}

export const fakeRedisStore = new FakeRedisStore();

export class FakeUpstashRedis {
  incr(key: string) {
    return Promise.resolve(fakeRedisStore.incr(key));
  }
  decr(key: string) {
    return Promise.resolve(fakeRedisStore.decr(key));
  }
  expire(key: string, seconds: number) {
    return Promise.resolve(fakeRedisStore.expire(key, seconds));
  }
  del(key: string) {
    return Promise.resolve(fakeRedisStore.del(key));
  }
  set(key: string, value: string, opts?: { nx?: boolean; px?: number }) {
    return Promise.resolve(fakeRedisStore.set(key, value, opts));
  }
  pttl(key: string) {
    return Promise.resolve(fakeRedisStore.pttl(key));
  }
}
