# @orbital-stellar/worker-core

Worker-side verification backfill and long-range replay substrate over CDP /
Galexie ledger exports.

Orbital operates **no ledger store of its own** (design doc §B.5): historical
ledgers are read from an external export and discarded; only derived verdicts
are written.

## What's here

- `exports/` — the shared **export reader** (`ExportReader` + `ExportSource`).
  One reader, two consumers: verification backfill (#1054) and long-range replay
  (#920). Ships `FileExportSource` (Galexie/CDP JSONL) and `MemoryExportSource`.
- `verification/canonical.ts` — the canonical `VerificationEvent` model and the
  **single** operation→event mapper shared by the export and live paths.
- `verification/verdict.ts` — `computeVerdict`, the **single** deterministic
  scoring function. Its `fingerprint` is byte-identical for export- and
  RPC-sourced inputs over the same range.
- `verification/backfill.ts` — `BackfillRunner`: resumable (checkpointed),
  idempotent (keyed upsert), marks verdicts `source: "backfill"`.
- `verification/liveVerifier.ts` — live path adapter that calls the same
  `computeVerdict`.
- `verification/stores.ts` — `VerdictSink` / `CheckpointStore`
  (in-memory + file).

## Quick start

```ts
import {
  BackfillRunner,
  ExportReader,
  FileExportSource,
  FileVerdictSink,
  FileCheckpointStore,
} from "@orbital-stellar/worker-core";

const reader = new ExportReader(
  new FileExportSource({ directory: "/exports/ledgers", format: "galexie" }),
);

const result = await new BackfillRunner({
  reader,
  range: { startLedger: 10_000_000, endLedger: 11_000_000 },
  windowSize: 1000,
  sink: new FileVerdictSink("/verdicts"),
  checkpoint: new FileCheckpointStore("/verdicts"),
  subjects: ["GABC...", "CDEF..."], // or omit to score every address
}).run();

// result.provenance states where the data was read from.
console.log(result.provenance);
```

See `docs/design/worker-verification-backfill.md` for the full design, the
byte-identical guarantee, and the cost model.
