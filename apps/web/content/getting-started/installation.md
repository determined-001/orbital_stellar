---
title: Installation
description: Add Orbital Stellar packages to your project.
---

## Requirements

- Node.js 18 or later
- A Stellar address to watch (mainnet or testnet)
- pnpm, npm, or yarn

## Install the packages

Install only the packages you need:

```bash
# Core event streaming (required by all other packages)
npm install @orbital/pulse-core

# Webhook delivery
npm install @orbital/pulse-webhooks

# React hooks
npm install @orbital/pulse-notify
```

## Server setup

The Orbital server acts as a proxy between Horizon and your application. Run it alongside your backend:

```bash
cd apps/server
npm run dev
```

By default it starts on port `3000` and connects to Stellar **testnet**. Override with environment variables:

```bash
PORT=4000 NETWORK=mainnet npm run dev
```

## Environment variables

### Server (`apps/server`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `NETWORK` | `testnet` | `testnet` or `mainnet` |

### Web (`apps/web`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SERVER_URL` | URL of the running server (e.g. `http://localhost:3000`) |

Create `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

## TypeScript

All packages ship with full TypeScript types. No `@types/*` packages needed.

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```
