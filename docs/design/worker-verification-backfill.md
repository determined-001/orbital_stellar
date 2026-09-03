# Worker verification backfill over CDP / Galexie exports

Issue #1054 — Phase 4, Workers W1. Depends on #19.1 and shares its export
substrate with #920 (long-range replay).

## Why this exists

RPC retains only ~7 days of ledger history. A reputation verdict computed over
a 7-day window is a weather report, not a track record. To score a subject over
a longer horizon we must read history that RPC no longer serves. That history is
available as **exports** — the Stellar Foundation's Galexie ledger exports and
the Composable Data Platform (CDP) history transform — but Orbital must never
operate a ledger store of its own to do it (design doc §B.5). Re-hosting the
chain is a different, much larger business.

## Architectural constraint: no Orbital ledger store

This implementation reads ledgers from an external export and **discards them**.
Nothing in this package writes a copy of the chain. The only thing persisted is
*derived verdicts* (small, per-subject-per-window records), which is a
legitimate output, not a re-hosted ledger.

The `BackfillRunner` is constructed with an `ExportSource` whose
`describe()` returns provenance — `{ kind, location }` — and the run result
surfaces that provenance. The PR body must state exactly where the data was
read from (e.g. `galexie://gs://some-bucket/ledgers` or a CDP dataset id) and
confirm it is operated by SDF / the export provider, not by Orbital.

## One export reader, two consumers

`BackfillRunner` (this issue) and the #920 replay consumer both depend on the
single `ExportReader` in `packages/worker-core/src/exports/`. The reader is
deliberately dumb about *meaning*:

- `ExportSource.read(range)` streams `ExportLedger` records in ascending
  `ledgerSequence`, deduplicated by the reader.
- `ExportReader` enforces range bounds and ledger-sequence dedupe.

Neither consumer re-implements ledger enumeration, paging, or dedupe. Concrete
sources shipped: `FileExportSource` (Galexie or CDP JSONL on local/object
storage) and `MemoryExportSource` (tests/tooling). A production CDP source can
be added as another `ExportSource` without touching the reader.

## Byte-identical overlap is the load-bearing test

The whole point of backfill is that a verdict computed from an export is the
*same* as one computed live. If the two paths could silently disagree, an
operator's score would change depending on when it was computed.

Both paths produce the same canonical `VerificationEvent` model via the *same*
`mapOperationToVerificationEvents` + canonicalization (`canonicalAmount`,
`canonicalAsset`, `canonicalAddress`) in `src/verification/canonical.ts`, and
both score through the *single* `computeVerdict` in
`src/verification/verdict.ts`. Because the verdict is a deterministic function
of canonicalized, order-independent inputs, the `fingerprint` (SHA-256 over the
canonical core) is identical whether the events arrived over RPC or from an
export.

- The verdict `source` marker (`"backfill"` vs `"live"`) is **outside** the
  fingerprinted core, so a backfilled verdict is *marked* as such yet
  byte-identical in substance to its live twin.
- The test `produces byte-identical verdict cores to the live path` feeds the
  two paths the *same logical ledgers expressed in different raw formatting*
  (export: `asset: "XLM"`, `amount: "10.0000000"`; live: `asset: "native"`,
  `amount: "10.0"`) and asserts equal core bytes. That proves the guarantee
  comes from canonicalization, not shared objects.

Window boundaries are globally aligned (`floor(ledger / windowSize) *
windowSize`), so a backfilled window and a live window overlap exactly when
their ledger ranges overlap.

## Resumable and idempotent

- **Checkpointing**: `BackfillRunner` records `lastProcessedLedger` at each
  *window flush* boundary into a `CheckpointStore`. On a resume it reads from
  the first ledger of the window containing that checkpoint, so a crash
  mid-window recomputes at most one window (idempotently).
- **Idempotent sink**: `VerdictSink.upsert` is keyed by
  `(subject, windowStart, windowEnd)`. Re-running a range — or resuming — only
  overwrites, never appends duplicates. Final verdicts are identical to a single
  uninterrupted run. This is covered by the `is idempotent` and `is resumable`
  tests.

## Cost model (export scanning is not free)

Scanning exports is a real, billable cost. The spend is driven by:

1. **Window length (`windowSize`)** — the primary spend dial. A longer window
   means fewer verdict records and fewer checkpoint writes, but each verdict
   aggregates more ledgers in memory and a crash reprocesses more ledgers (up
   to one window) on resume. A shorter window makes resumes cheaper and verdicts
   more granular, at the cost of more sink records and more frequent checkpoint
   writes (object-storage PUTs).
2. **Range size** — cost is linear in the number of ledgers scanned; there is no
   shortcut. Backfilling `N` ledgers reads `N` ledger records from the export,
   period.
3. **Checkpoint write frequency** — one PUT per flushed window (not per ledger),
   by design. For very large ranges this is the dominant write-side cost and is
   bounded by `range / windowSize`.
4. **Sink writes** — one upsert per (subject, window). Scoring *every* address
   (`subjects` omitted) scales with distinct addresses in the range; passing an
   explicit `subjects` allow-list bounds it to the entities you actually care
   about. This is the cheapest way to cut cost when backfilling for a known set
   of contracts/accounts.

Recommended defaults: `windowSize = 1000` for production backfills; pass
`subjects` whenever the target set is known; treat a backfill run as a batch job
with a bounded ledger budget, not an open-ended stream.

## Affected files

- `packages/worker-core/src/exports/` — shared export reader (`types.ts`,
  `parsers.ts`, `sources.ts`). Reused by #920.
- `packages/worker-core/src/verification/canonical.ts` — canonical
  `VerificationEvent` model + the shared mapper (export *and* live).
- `packages/worker-core/src/verification/verdict.ts` — `computeVerdict`, the
  single scoring function; `verdictCore` / `verdictCoreBytes` for byte-identical
  comparison.
- `packages/worker-core/src/verification/backfill.ts` — `BackfillRunner`
  (resumable, idempotent, marks `source: "backfill"`).
- `packages/worker-core/src/verification/liveVerifier.ts` — live path adapter
  that calls the same `computeVerdict`.
- `packages/worker-core/src/verification/stores.ts` — `VerdictSink` /
  `CheckpointStore` (in-memory + file).
- `packages/worker-core/test/verification/backfill.test.ts` — byte-identical,
  resumable, idempotent, end-to-end file-export tests.
