# orbital/web

**The public Orbital site** - landing page, documentation, and live testnet demos. Built with Next.js 16, Tailwind CSS, and Framer Motion. Also hosts the marketing-demo API routes (`/api/events/[address]`, `/api/webhook-sample`) that power the on-page sandbox.

## Running locally

```bash
pnpm install
NEXT_PUBLIC_NETWORK=testnet pnpm --filter orbital/web dev
```

The site runs on `http://localhost:3000`.

## Environment

| Variable | Required | Values | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_NETWORK` | yes | `testnet` \| `mainnet` | Stellar network the demo `EventEngine` subscribes to. Surfaced in the UI's network notice. Fails loudly at first request if missing or invalid. |
| `DEMO_EMITTER_CONTRACT_ID` | **yes in production**, for fire-event | contract ID | Demo-emitter contract. In local development only, falls back to `contracts/deployed.testnet.json`. |
| `DEMO_EMITTER_SECRET` | for fire-event | Stellar secret | Server-only invoker for `ping()` — never exposed to the client. |
| `DEMO_EMITTER_RPC_URL` | no | URL | Soroban RPC endpoint. Defaults to `https://soroban-testnet.stellar.org`. |
| `DEMO_EMITTER_NETWORK_PASSPHRASE` | no | passphrase | Defaults to the testnet passphrase. The demo path refuses to sign on mainnet. |
| `UPSTASH_REDIS_REST_URL` | for fire-event | URL | Shared Upstash Redis REST URL (serverless rate limit). |
| `UPSTASH_REDIS_REST_TOKEN` | for fire-event | token | Shared Upstash Redis REST token. |
| `TRUSTED_PROXY_HOPS` | non-Vercel only | positive integer | Number of reverse proxies in front of the app. See [Client identification](#client-identification). |

### The manifest fallback is local-development only

`contracts/deployed.testnet.json` lives outside `apps/web` and is not traced into the
serverless bundle, so it is never present in a deployed build. Relying on it in production
made the demo report itself unconfigured with nothing logged (#1030). In production
`DEMO_EMITTER_CONTRACT_ID` is therefore required, and the fallback is skipped entirely.

`GET /api/demo/config` returns `{ configured, status, reason? }`, where `status` is:

| `status` | Meaning |
|---|---|
| `ok` | Contract ID and secret both resolved. |
| `unconfigured` | Nothing is set — the feature is deliberately off in this environment. |
| `unreadable` | A deployment manifest exists but could not be read or parsed. |

## Client identification

Every per-IP limit below is keyed on `clientIp()` in `lib/demo-limits.ts`. Forwarding headers are
client-settable unless something in front of the app overwrites them, so trust is explicit:

1. **On Vercel** — `x-vercel-forwarded-for` is stamped by the edge from the real socket peer on every
   request and cannot be forged. Nothing to configure.
2. **Behind your own proxy** — set `TRUSTED_PROXY_HOPS` to the number of proxies that append to
   `X-Forwarded-For` (usually `1`). The Nth segment from the right is used; the client-controlled prefix
   is ignored.
3. **Unset** — `X-Forwarded-For` is ignored entirely and all unidentified callers share a single
   rate-limit bucket.

Case 3 over-limits anonymous traffic rather than under-limiting it. That is deliberate: `DEMO_EMITTER_SECRET`
signs real testnet transactions, so a misconfigured deploy must throttle everyone rather than let anyone
mint unlimited buckets by rotating a header. `x-real-ip` is not consulted — it carries no append semantics,
so a directly-reachable origin cannot distinguish a proxy-set value from a client-set one.

## Demo limits

The on-page demos are intentionally sandboxed so they don't burn Vercel resources:

- **`/api/events/[address]`** - 1 concurrent SSE stream per IP, 25-second max duration per stream.
- **`/api/webhook-sample`** - 1 signing request per IP every 20 seconds.
- **`/api/demo/fire-event`** - 1 on-chain fire per IP every 10 seconds via Upstash Redis (`lib/fireEventRateLimit.ts`). Without Upstash env vars the route returns `503` (fail closed).

When a limit trips, the route returns `429` with a JSON envelope (`{ error: "demo_limit_reached", reason, message, upgradeUrl }`) and the demo components surface an "Upgrade to Orbital Cloud" call-to-action. Tune the numbers in `lib/demo-limits.ts`.

## Structure

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages, layouts, and `/api/*` route handlers |
| `components/` | Reusable UI components |
| `content/` | Markdown-sourced content (docs, blog posts) rendered via `gray-matter` + `marked` |
| `lib/` | Utilities - content loaders, demo engine singleton, rate limits, env validation |

## Content authoring

Documentation pages are authored in Markdown under `content/`. Frontmatter is parsed by `gray-matter`; body is rendered by `marked`. To add a new page:

1. Drop a `.md` file into the appropriate `content/` subdirectory.
2. Register it in `lib/docroutes.ts` under the relevant section - this controls the sidebar order, search indexing, and static route generation. Pages not registered there will not appear in the sidebar or search results.

## Styling

Tailwind CSS 4 is configured in `tailwind.config.ts`. Use utility classes directly; avoid authoring bespoke CSS modules. Design tokens (color palette, typography scale) are defined in the Tailwind config.

## Deployment

The site is deployed via Vercel from the `main` branch. Preview deploys run automatically on pull requests.

## Contributing

Content corrections, typo fixes, and new tutorial pages are welcome. For larger changes (new sections, design overhauls) open an issue first - the design system is intentionally constrained.

## License

MIT
