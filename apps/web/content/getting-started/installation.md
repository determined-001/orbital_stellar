---
title: Installation
description: Add Orbital packages to your project.
---

## Requirements

- Node.js 20 or 22
- pnpm, npm, or yarn

## Install the packages

Install only the packages you need — each is independently usable.

```bash
# Event engine — required by everything else
pnpm add @orbital-stellar/pulse-core

# Webhook delivery (optional)
pnpm add @orbital-stellar/pulse-webhooks

# React hooks (optional)
pnpm add @orbital-stellar/pulse-notify react
```

## TypeScript

All three packages ship with full TypeScript types. No `@types/*` packages are needed.

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

The event union (`NormalizedEvent`) is a discriminated union — `switch` on `event.type` and TypeScript narrows the rest of the shape per branch.

## Edge runtimes

`@orbital-stellar/pulse-webhooks` exports two verifiers:

- **`verifyWebhook`** — Node.js (`crypto` module)
- **`verifyWebhookEdge`** — Web Crypto API; works in Cloudflare Workers, Vercel Edge, Deno, and browsers

Pick the one that matches your runtime. The signing side (`WebhookDelivery`) requires Node.js for now.

## React

`@orbital-stellar/pulse-notify` is browser-only — it uses `EventSource`, which doesn't exist in Node. In Next.js App Router, mark consuming components with `"use client"`. In Remix or Vite SSR, gate the hook behind a client-only boundary.

## Trying the reference composition (optional)

Want to see the SDKs composed end-to-end before building your own backend? Clone the repo and run the marketing site — it ships a sandboxed Next.js route handler that subscribes to a Stellar address and streams events as SSE:

```bash
git clone https://github.com/orbital/orbital.git
cd orbital
pnpm install
NEXT_PUBLIC_NETWORK=testnet pnpm --filter orbital/web dev
```

Open `http://localhost:3000` for the site, or hit the route directly:

```bash
curl -N http://localhost:3000/api/events/GABC...
```

The reference handler lives at `apps/web/app/api/events/[address]/route.ts` — copy and adapt it. **It's sandboxed for the public demo** (1 concurrent stream per IP, 25s session cap); strip the limits in `apps/web/lib/demo-limits.ts` for production use, or use Orbital Cloud (in development).

## Next step

→ [Quick Start](./quick-start) — wire up your first event subscription in five minutes.
