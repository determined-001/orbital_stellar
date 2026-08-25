# orbital-next-starter

Live, typed Stellar events in the browser via React hooks, with the event engine
and cursor on the server.

The engine keeps one long-lived Horizon connection per server process and a
file-backed cursor; the browser gets a plain SSE stream. That split is the point
— your Stellar credentials and your cursor never leave the server, and the
client is just `useStellarEvent`.

## Quickstart

```bash
cp .env.example .env.local   # set STELLAR_ADDRESSES
pnpm install
pnpm dev
```

Open http://localhost:3000, pick an address, and events appear as the account
transacts. On testnet you can trigger one with Friendbot or any wallet payment.

## How it fits together

| Piece | File | What it does |
|---|---|---|
| Config | `lib/config.ts` | Validates env at startup; refuses to boot on a bad address |
| Engine | `lib/engine.ts` | One `EventEngine` per process, cached on `globalThis`, `FileCursorStore` for resume |
| SSE route | `app/api/events/[address]/route.ts` | Bridges engine → browser; heartbeats every 10s |
| UI | `app/EventFeed.tsx` | `useStellarEvent({ serverUrl: "/api", address })` |

`useStellarEvent` builds its URL as `${serverUrl}/events/${address}`, which is
why `serverUrl` is `"/api"` and the route lives at `app/api/events/[address]`.

## Deploy

One-click to Vercel from the [starters page](https://orbital-stellar.vercel.app/starters).
Because this lives inside the Orbital monorepo, the deploy link sets
**Root Directory** to `examples/next-starter` — if you deploy manually, set that
yourself or the build will run against the repo root.

Set `STELLAR_ADDRESSES` in the project's environment variables. Note that
`CURSOR_DIR` writes to the local filesystem, which is ephemeral on serverless —
for production, swap `FileCursorStore` in `lib/engine.ts` for a durable
`CursorStore` (Postgres and Redis implementations ship in `@orbital-stellar/pulse-core`).

## Extending it

`lib/config.ts` already reads an optional `DEMO_CONTRACT_ID` and rejects the
placeholder values that `contracts/deploy/deploy_testnet.sh` writes before a real
deployment. Wire it to `engine.subscribeContract()` and `useContractEvent` from
`@orbital-stellar/pulse-notify` to add a typed contract-event page.
