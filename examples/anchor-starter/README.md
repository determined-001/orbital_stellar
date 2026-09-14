# orbital-anchor-starter

A runnable SEP-24/31 anchor consumer, built on `@orbital-stellar/anchor-sdk`:
SEP-1 discovery, SEP-10 authentication, an interactive SEP-24 deposit, and a
SEP-31 cross-border send - all against a real anchor.

By default it talks to Stellar Development Foundation's own reference anchor,
`testanchor.stellar.org`, on testnet. It's the SDF's own service, purpose-built
for exactly this - no mock server to run, no infrastructure of your own.

## Quickstart

```bash
cp .env.example .env   # set STELLAR_SECRET to a funded testnet account
export $(cat .env | grep -v '^#' | xargs)
pnpm install
pnpm dev deposit
```

That authenticates, starts an interactive SEP-24 deposit, and prints a URL.
Open it in a browser to complete the anchor-hosted KYC/payment flow, and the
CLI polls the transaction status until it settles (or 30s pass - the flow is
still running server-side either way; re-run to check on it).

```bash
pnpm dev send 10
```

Starts a SEP-31 cross-border send of 10 units of `ASSET_CODE`. A real send
needs `sender_id`/`receiver_id` from prior SEP-12 registration; without them,
or for an asset the anchor doesn't list under SEP-31 `/info`, the CLI reports
exactly why rather than crashing - that's the anchor correctly enforcing the
SEP, not a bug here. (As of this writing, the default reference anchor's
`/sep31/info` lists no receivable assets at all - verified live - so a send
against it will report that and stop; the code path is spec-correct and will
complete against any anchor that has SEP-31 assets configured.)

```bash
pnpm dev balance GDESTINATION...
```

Reads a Stellar account's mainnet USDC balance via a read-only contract
simulation - no anchor session, no `STELLAR_SECRET`, no transaction ever
submitted. Real usage for a SEP-31 sender: confirm a cross-border send
actually landed by checking the recipient's balance before and after.

## How it fits together

| Piece | File | What it does |
|---|---|---|
| Config | `src/config.ts` | Validates env at startup; refuses to boot without `STELLAR_SECRET` |
| Connect | `src/anchor.ts` | SEP-1 discovery + SEP-10 authentication in one call, returns an `AnchorSession` |
| Commands | `src/commands.ts` | `deposit()` (SEP-24 interactive + poll) and `send()` (SEP-31) |
| Balance | `src/balance.ts` | `checkUsdcBalance()` - mainnet USDC, typed with the generated `usdc.ts` |
| CLI | `src/index.ts` | Argument parsing, dispatches to `deposit`/`send`/`balance` |

## Getting a funded testnet account

```bash
stellar keys generate anchor-demo --network testnet --fund
stellar keys show anchor-demo
```

Use the printed secret key (`S...`) as `STELLAR_SECRET`.

## Generated contract types

`src/generated/` is `orbital codegen` output (`orbital.config.ts`), committed
rather than built on the fly: typed params/returns, zod schemas, and event
type guards for the deployed testnet demo-emitter contract and mainnet USDC
(a well-known Stellar Asset Contract, resolved from this repo's bundled
specs rather than on-chain WASM discovery — see the config's comments).
`balance` above uses `usdc.ts`'s `BalanceParams`/`BalanceReturns` to type a
real simulated `balance()` call.

Regenerate after either contract's spec changes:

```bash
pnpm --filter orbital-anchor-starter codegen
```

Check for drift without writing (what CI runs):

```bash
pnpm --filter orbital-anchor-starter codegen:check
```

## Extending it

- **SEP-12 (KYC)**: `Sep12Client` from `@orbital-stellar/anchor-sdk` is what
  both `Sep24CustomerInfoNeededError` and `CustomerInfoNeededError` point you
  at - register the requested fields, then retry `deposit`/`send`.
- **SEP-6 (non-interactive transfer)**: not wired here; `anchor-sdk` doesn't
  implement it yet.
- **A different anchor**: set `HOME_DOMAIN` to any anchor's home domain (no
  scheme). Discovery, auth, and both commands work against any SEP-1-compliant
  anchor, not just the reference one.
