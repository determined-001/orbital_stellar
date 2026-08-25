# orbital-express-starter

A runnable backend reference: ingest Stellar events, persist a cursor, deliver
HMAC-signed webhooks, and verify them on the receiving end. `docs/COOKBOOK.md`
describes this composition in prose — this is the version that compiles.

Implements issue 9.2 (#897).

## Why Express

The issue allows Express or Fastify. Express, because this is a *reference*: the
point is that a reader recognises the shape and can lift it into the app they
already run, and Express is still what most Node backends use. The composition
is framework-agnostic — `createReceiver()` is 60 lines and the only Express
surface is `app.post`.

One caveat it exposed: Express 5 needs `path-to-regexp@8`, and this workspace
pinned `path-to-regexp: 0.1.13` globally for [GHSA-9wv6-86v2-598j](https://github.com/advisories/GHSA-9wv6-86v2-598j).
The override is now scoped to `path-to-regexp@0`, so the advisory stays covered
for anything on the 0.x line and Express 5 gets the version its router needs.

## Quickstart

```bash
cp .env.example .env      # set STELLAR_ADDRESSES and WEBHOOK_SECRET
pnpm dev
```

That runs against testnet with a file-backed cursor and no containers. The
process is both sender and receiver: it delivers signed webhooks to its own
`/hooks/stellar`, which verifies them — so you can watch the whole loop locally.

With Postgres:

```bash
docker compose up -d
DATABASE_URL=postgres://orbital:orbital@127.0.0.1:5432/orbital pnpm dev
```

The `cursor_store` table is created on startup if it does not exist.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `STELLAR_ADDRESSES` | — (required) | Comma-separated accounts to watch |
| `WEBHOOK_SECRET` | — (required, ≥16 chars) | Shared HMAC secret |
| `STELLAR_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `WEBHOOK_URL` | this process's receiver | Where deliveries go |
| `PORT` | `3000` | Receiver and `/healthz` |
| `DATABASE_URL` | unset | Postgres cursor; file-backed when unset |
| `CURSOR_FILE` | `.orbital-cursor.json` | File cursor location |

Startup refuses to run on a missing address list, a secret under 16 characters,
or a non-numeric port — a misconfigured ingester that starts anyway is worse
than one that does not.

## Resume after a restart

The guarantee: **stop the service, restart it, and it resumes from the last
event it delivered — no gap, no replay.**

Walk through it:

1. **Start it and let an event arrive.**
   ```bash
   pnpm dev
   ```
   Send a testnet payment to a watched address (the
   [Stellar Laboratory](https://laboratory.stellar.org) is the quickest way).
   You will see the delivery and then the receiver verifying it:
   ```
   [receiver] verified payment.received at 2026-08-02T12:00:00Z
   ```

2. **Look at the cursor.**
   ```bash
   cat .orbital-cursor.json
   # {"horizon:testnet":"241234567890123"}
   ```
   That is the paging token of the last event the engine processed.

3. **Stop with Ctrl-C** (SIGINT) or `kill -TERM <pid>`. The handler calls
   `engine.stop()` and *awaits it* before exiting, so the final cursor write
   lands:
   ```
   [starter] SIGTERM received, shutting down
   [starter] stopped cleanly
   ```

4. **Send another payment while it is down.**

5. **Start it again.** The engine reads the cursor and resumes from it, so the
   event sent during the outage is delivered now rather than skipped. Nothing
   before the cursor is redelivered.

With `DATABASE_URL` set, step 2 is a row in `cursor_store` instead of a file,
and the same guarantee holds across several instances sharing the database.

## Verifying deliveries

`src/receiver.ts` is the half you would deploy in your own service. Two things
it does deliberately:

- **Verifies against the raw body.** `express.json()` parses and re-serialises,
  and the re-serialised bytes are not always identical to what was signed. The
  route reads the body as text and parses only after the signature checks out.
- **Rejects rather than logs.** A tampered payload gets a `401` and never
  reaches application code. `onRejected` is there to feed your alerting.

Both are covered by tests: a correctly signed delivery is accepted, and a
payload with one digit changed after signing is rejected.

It also rate-limits per IP (120 requests/minute by default, `rateLimit` and
`rateLimitWindowMs` to change it), checked *before* any HMAC work — verification
is the resource an unauthenticated flood would burn, even though nothing gets
through. It uses `express-rate-limit`, whose counters are in-process by default; behind
more than one replica, give it a shared store or each replica enforces its own
budget.

## Tests

```bash
pnpm --filter orbital-express-starter test
```

Sixteen tests, no containers needed: signature acceptance and rejection
(tampered body, wrong secret, missing headers), cursor persistence and resume,
configuration refusals, rate limiting, and the SIGTERM ordering — asserting `stop()` completes
*before* `process.exit`, since exiting first is what loses the last cursor
write.

Postgres itself is not exercised in CI; `docker compose up -d` plus the
`DATABASE_URL` run above is the manual check.
