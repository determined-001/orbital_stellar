# Long-range replay beyond RPC retention

Design note for issue #920 ("12.6 Long-range replay via Composable Data
Platform and CAP-67 backfill"). The issue's implementation note is explicit
that this is the one issue in the backlog where implementing before agreeing
the source risks building the wrong thing entirely - this document is that
agreement, written before any code.

## 1. The problem, verified live

Soroban RPC retains a bounded window of ledger history. Querying it directly
(`https://soroban-testnet.stellar.org`, 2026-09-14) confirms the exact shape
of the failure:

```
latest ledger: 4679957
requesting startLedger: 4479957 (200,000 ledgers back)

ERROR: { code: -32600, message: "startLedger must be within the ledger
  range: 4558999 - 4679958" }
```

`(4679958 - 4558999) × 5s ≈ 6.9999 days` - confirms the issue's "roughly
seven days" and, more usefully, gives the exact mechanism: a JSON-RPC error
with `code: -32600` whose `message` names the currently-retained range in
plain text. This is not a documented, stable API contract (parsing an error
string is inherently fragile to a wording change), but it is the only
signal Soroban RPC actually gives today, and **it is what makes "out-of-
retention errors name the retention boundary" (the issue's own acceptance
criterion) possible at all** - the boundary comes from the RPC's own error,
not a guessed constant.

## 2. Source choice: a backfill-configured RPC, not Galexie

The issue asks for a documented choice between a Galexie export bucket and
a `BACKFILL_STELLAR_ASSET_EVENTS`-populated RPC, with cost and latency
analysis.

**Choice: a second Soroban RPC endpoint configured with extended retention**
(a self-hosted node with `--history-retention-window` raised, or a
third-party provider's deep-retention endpoint). Reasons:

| | Backfill RPC | Galexie (Composable Data Platform) |
| --- | --- | --- |
| **API shape** | Identical `getEvents(startLedger, filters, cursor)` this engine already calls | Raw `LedgerCloseMeta` XDR exports to GCS/BigQuery - a different data shape entirely |
| **Engineering cost** | Zero new parsing - the existing `SorobanSubscriber`/event-decode path is reused unchanged | Net-new: XDR ledger-close-meta parsing, contract-event extraction, and a GCS/BigQuery client, none of which exist in this codebase today |
| **Latency for this use case** | Comparable to a normal `getEvents` call - seconds | Batch-export model: a BigQuery scan or a cold GCS object fetch, meaningfully slower for "replay this narrow range now" |
| **Cost model** | Bounded, known infra cost (extra retention storage on an RPC node) | Usage-based BigQuery/GCS billing, plus the one-time and ongoing cost of maintaining a second parser |
| **Fits the actual use case** | Yes - audit/compliance replay of a specific worker's narrow ledger range (the issue's own stated case) | Better suited to bulk historical analytics across the whole ledger, which is not what a worker-verification replay needs |

**The codebase already signals this choice.** `backfillReplay.e2e.test.ts`
(issue 6.15, closed) and `.github/workflows/integration.yml` already define
`BACKFILL_RPC_URL`, `BACKFILL_START_LEDGER`, `BACKFILL_END_LEDGER`,
`BACKFILL_CONTRACT_ID` - a second-RPC-endpoint shape, not a Galexie-shape
env var among them. This design formalizes what that scaffold already
assumes rather than introducing a third option.

Galexie is not rejected outright - the "what this note does not decide"
section below leaves it open for a genuinely bulk historical-analytics use
case, which is a different problem from replaying one worker's window.

## 3. `HistoricalSource`: adapter-agnostic by construction

```ts
export interface HistoricalSource {
  /** True if this source's own retention covers `ledger`. Cheap - may be a bound check, not a network call. */
  covers(ledger: number): Promise<boolean> | boolean;
  /** Same event shape and pagination contract as SorobanRpcLike.getEvents. */
  getEvents(request: GetEventsRequest): Promise<GetEventsResponse>;
}
```

Deliberately the *same shape* Soroban RPC's `getEvents` already has - not
a bespoke "historical event" type. This is what lets a `HistoricalSource`
plug into the exact same decode path `SorobanSubscriber` already runs,
producing byte-identical `NormalizedEvent` output regardless of which
source answered (the issue's own acceptance criterion). One reference
adapter: `RpcHistoricalSource`, wrapping any second `SorobanRpcLike` -
concretely, a backfill-configured RPC per §2, but the interface does not
know or care that the adapter happens to be an RPC client. A Galexie-backed
adapter would implement the same two methods differently.

## 4. Wiring: extends `replayContracts`, does not bypass transport routing

Per the issue's implementation note 3: `HistoricalSource` must not become a
second source-selection path alongside 6.12's `effectiveIngestion`
(`"unified" | "horizon"`) live-streaming routing. It does not - `EventEngine`
already has exactly one place that does bounded, cursor-free, one-shot
ledger-range replay: `replayContracts` (§ used by `backfillReplay.e2e.test.ts`
today). `HistoricalSource` is a fallback *within that one method*, not a
second entry point:

1. `replayContracts` is called with `startLedger` as always.
2. If the primary `rpc.getEvents` call fails with the `-32600` /
   "must be within the ledger range" shape from §1, and a `historicalSource`
   was configured, `EventEngine` parses the retained lower bound from the
   error, and - only if `startLedger` is older than it - retries the same
   request shape against `historicalSource` instead.
3. Once the historical source's own coverage is exhausted (or was never
   configured), the error is re-thrown as `OutOfRetentionError`, naming
   the parsed retention boundary and whether a historical source was
   configured, per the acceptance criterion.

`effectiveIngestion`'s live-streaming routing is untouched - this fallback
only ever fires inside a bounded, already-terminating replay run.

## 5. Cursor compatibility (issue 6.14)

`docs/cursor-format.md` already specifies the unified-stream cursor as a
`toid`-style, lexically-sortable string - "two cursors can be compared as
plain strings without decoding them." `RpcHistoricalSource.getEvents`
returns the same cursor shape Soroban RPC's `getEvents` does (both are
`toid`-style pagination cursors over the same ledger/tx/operation ordering),
so a cursor obtained mid-replay from the primary RPC and one obtained from
the historical source compare and chain correctly without a translation
layer. This is what "one cursor spans both transports" means in practice:
no new cursor format, because both transports already speak the same one.

## 6. What this note does not decide

- **A Galexie adapter.** Left for whoever has an actual bulk-analytics use
  case that needs it - §2 is not a permanent rejection, just not this
  issue's problem.
- **Which backfill-RPC provider or self-hosted retention window to run in
  production.** An infrastructure/ops decision, not an interface one.
- **Error-string parsing fragility (§1).** Soroban RPC does not publish a
  stable, structured "oldest retained ledger" field today. If a future RPC
  version changes the message wording, `OutOfRetentionError`'s boundary
  parsing degrades to "boundary unknown" rather than crashing - documented
  in the implementation, not silently assumed stable forever.

## Review checklist

1. Is a backfill-configured second RPC (§2) the right source, given the
   codebase's own existing `BACKFILL_*` env var scaffold already assumes it?
2. Is falling back *within* `replayContracts` (§4), rather than adding a
   second routing path, the right integration point?
3. Is parsing the retention boundary from Soroban RPC's own `-32600` error
   text (§1) - the only signal available today - an acceptable foundation,
   given its documented fragility?
