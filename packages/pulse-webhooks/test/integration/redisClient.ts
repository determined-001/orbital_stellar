import net from "node:net";

import type { RedisLike } from "../../src/index.js";

type Reply = string | number | null | Reply[];

/**
 * The smallest RESP client that satisfies {@link RedisLike}, so the integration
 * test can run the queue's Lua against a real Redis without the package taking
 * on a client dependency it does not otherwise need.
 */
export class MinimalRedisClient implements RedisLike {
  private readonly socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private readonly pending: Array<{
    resolve: (value: Reply) => void;
    reject: (error: Error) => void;
  }> = [];

  private constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
    this.socket.on("error", (error) => {
      while (this.pending.length > 0) this.pending.shift()!.reject(error);
    });
  }

  static connect(url: string): Promise<MinimalRedisClient> {
    const { hostname, port } = new URL(url);
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: hostname, port: Number(port || 6379) }, () => {
        resolve(new MinimalRedisClient(socket));
      });
      socket.once("error", reject);
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.end(resolve));
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return Number(await this.command("ZADD", key, String(score), member));
  }

  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    ...args: Array<number | string>
  ): Promise<string[]> {
    const reply = await this.command(
      "ZRANGEBYSCORE",
      key,
      String(min),
      String(max),
      ...args.map(String),
    );
    return (reply as string[]) ?? [];
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const reply = await this.command("ZREVRANGE", key, String(start), String(stop));
    return (reply as string[]) ?? [];
  }

  async zrem(key: string, member: string): Promise<number> {
    return Number(await this.command("ZREM", key, member));
  }

  async zcard(key: string): Promise<number> {
    return Number(await this.command("ZCARD", key));
  }

  async hget(key: string, field: string): Promise<string | null> {
    return (await this.command("HGET", key, field)) as string | null;
  }

  async hlen(key: string): Promise<number> {
    return Number(await this.command("HLEN", key));
  }

  async del(...keys: string[]): Promise<number> {
    return Number(await this.command("DEL", ...keys));
  }

  async eval(
    script: string,
    numKeys: number,
    ...keysAndArgs: Array<number | string>
  ): Promise<unknown> {
    return this.command("EVAL", script, String(numKeys), ...keysAndArgs.map(String));
  }

  private command(...args: string[]): Promise<Reply> {
    const payload =
      `*${args.length}\r\n` +
      args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join("");

    return new Promise<Reply>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      this.socket.write(payload);
    });
  }

  private drain(): void {
    for (;;) {
      const parsed = this.parse(this.buffer, 0);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.offset);
      const waiter = this.pending.shift();
      if (!waiter) return;
      if (parsed.error) waiter.reject(new Error(parsed.error));
      else waiter.resolve(parsed.value);
    }
  }

  private parse(
    buffer: Buffer,
    offset: number,
  ): { value: Reply; offset: number; error?: string } | null {
    const end = buffer.indexOf("\r\n", offset);
    if (end === -1) return null;

    const type = String.fromCharCode(buffer[offset]!);
    const body = buffer.toString("utf8", offset + 1, end);
    const next = end + 2;

    if (type === "+") return { value: body, offset: next };
    if (type === "-") return { value: null, offset: next, error: body };
    if (type === ":") return { value: Number(body), offset: next };

    if (type === "$") {
      const length = Number(body);
      if (length === -1) return { value: null, offset: next };
      if (buffer.length < next + length + 2) return null;
      return { value: buffer.toString("utf8", next, next + length), offset: next + length + 2 };
    }

    if (type === "*") {
      const count = Number(body);
      if (count === -1) return { value: null, offset: next };
      const items: Reply[] = [];
      let cursor = next;
      for (let i = 0; i < count; i += 1) {
        const item = this.parse(buffer, cursor);
        if (!item) return null;
        items.push(item.value);
        cursor = item.offset;
      }
      return { value: items, offset: cursor };
    }

    throw new Error(`MinimalRedisClient: unsupported reply type "${type}"`);
  }
}
