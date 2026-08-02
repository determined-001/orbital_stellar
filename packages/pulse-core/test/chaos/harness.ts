/**
 * Fault-injection harness for the reconnection chaos suite (#922).
 *
 * The engine's reconnect path is exercised elsewhere against a well-behaved
 * fake. This harness models the transport misbehaving instead: dropping
 * mid-stream, stalling without closing, rate limiting with and without a
 * `Retry-After`, and emitting records that do not parse.
 *
 * Randomness is seeded so a failure is reproducible from the seed printed in
 * the log - set `CHAOS_SEED` to replay one.
 */

export type StreamHandlers = {
  onmessage: (record: unknown) => void;
  onerror: (error: unknown) => void;
};

export type FaultyStream = {
  /** Cursor the engine opened this stream with. */
  cursor: string;
  handlers: StreamHandlers;
  closed: boolean;
  close: () => void;
};

/** Deterministic PRNG (mulberry32) - same seed, same fault sequence. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resolves the seed for a run: `CHAOS_SEED` when set, otherwise the default. */
export function resolveSeed(defaultSeed = 20260802): number {
  const fromEnv = process.env.CHAOS_SEED;
  if (!fromEnv) return defaultSeed;
  const parsed = Number.parseInt(fromEnv, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`CHAOS_SEED must be an integer, received "${fromEnv}"`);
  }
  return parsed;
}

/** Every stream the engine has opened, oldest first. */
export const streams: FaultyStream[] = [];

export function resetStreams(): void {
  streams.length = 0;
}

export function latestStream(): FaultyStream {
  const stream = streams.at(-1);
  if (!stream) throw new Error("Expected the engine to have opened a stream.");
  return stream;
}

/**
 * Mock `Horizon.Server` that records every stream it hands out. Pass this to
 * `vi.mock("@stellar/stellar-sdk", ...)`.
 */
export class FaultyHorizonServer {
  operations() {
    return {
      cursor(cursor: string) {
        return {
          stream(handlers: StreamHandlers) {
            const stream: FaultyStream = {
              cursor,
              handlers,
              closed: false,
              close: () => {
                stream.closed = true;
              },
            };
            streams.push(stream);
            return stream.close;
          },
        };
      },
    };
  }
}

/** The account the chaos suite subscribes with. */
export const SUBSCRIBER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const COUNTERPARTY = "GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX";

/** An inbound payment record with a monotonic paging token. */
export function paymentRecord(sequence: number): Record<string, unknown> {
  return {
    type: "payment",
    id: String(sequence),
    paging_token: String(sequence),
    created_at: new Date(1_700_000_000_000 + sequence * 1000).toISOString(),
    transaction_successful: true,
    source_account: COUNTERPARTY,
    from: COUNTERPARTY,
    to: SUBSCRIBER,
    amount: "10.0000000",
    asset_type: "native",
  };
}

/** A record the normalizer cannot make sense of. */
export function malformedRecord(): Record<string, unknown> {
  return { type: "payment", id: undefined as unknown as string, garbage: Symbol("nope") };
}

/** An error shaped like a Horizon rate-limit response. */
export function rateLimitError(retryAfterSeconds?: number): unknown {
  return {
    response: {
      status: 429,
      headers: retryAfterSeconds === undefined ? {} : { "Retry-After": String(retryAfterSeconds) },
    },
  };
}

/** A generic transport failure - DNS, reset connection, half-open socket. */
export function transportError(message: string): Error {
  return new Error(message);
}
