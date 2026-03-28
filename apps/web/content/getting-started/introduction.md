---
title: Introduction
description: What is Orbital Stellar and why you need it.
---

## What is Orbital Stellar?

Orbital Stellar is a real-time event infrastructure layer for the [Stellar](https://stellar.org) blockchain. It bridges the gap between on-chain activity and your application by providing:

- **Webhooks** — register an endpoint and receive HTTP POST requests whenever activity occurs on a watched address
- **Server-Sent Events** — stream live events directly to your browser or backend via SSE
- **React hooks** — `useStellarPayment`, `useStellarActivity`, and more for building reactive UIs

## Why use it?

Stellar's Horizon API exposes an SSE stream, but consuming it safely — with reconnection logic, event routing, HMAC signing, and retry delivery — requires significant boilerplate. Orbital Stellar handles all of that for you.

## Architecture overview

```
Stellar Network
      │
      ▼
  Horizon SSE
      │
      ▼
  EventEngine          ← @orbital/pulse-core
  (address routing)
      │
  ┌───┴────────────┐
  ▼                ▼
Webhooks        React hooks
(pulse-webhooks) (pulse-notify)
```

## Packages

| Package | Description |
|---------|-------------|
| `@orbital/pulse-core` | Horizon SSE manager, event normalization, reconnection |
| `@orbital/pulse-webhooks` | HMAC-signed webhook delivery with retry logic |
| `@orbital/pulse-notify` | React hooks for client-side event subscription |

## Event types

Currently Orbital Stellar normalizes Stellar payment operations into two event types:

- `payment.received` — a payment arrived at the watched address
- `payment.sent` — a payment left the watched address

More operation types are coming in future releases.
