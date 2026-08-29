/**
 * @orbital-stellar/worker-core
 *
 * Worker-side verification backfill and long-range replay substrate over
 * CDP / Galexie ledger exports. Orbital operates no ledger store of its own:
 * every historical ledger is read from an external export and discarded; only
 * derived verdicts are written.
 *
 * The export reader here is shared with #920 (long-range replay). The verdict
 * engine ({@link computeVerdict}) is shared between the live verifier and the
 * backfill runner, which is what makes a backfilled verdict byte-identical to
 * a live-computed one for any overlapping range.
 */

// Export reader (shared substrate: backfill + replay).
export { ExportReader } from "./exports/types.js";
export type {
  ExportSource,
  ExportLedger,
  ExportOperation,
  ExportTransaction,
  ExportSourceKind,
  LedgerRange,
} from "./exports/types.js";
export { FileExportSource, MemoryExportSource } from "./exports/sources.js";
export type { ExportFormat } from "./exports/sources.js";
export { parseGalexieLedger, parseCdpLedger } from "./exports/parsers.js";

// Verification canonical model + verdict engine (shared by live + backfill).
export {
  canonicalAmount,
  canonicalAsset,
  canonicalAddress,
  inferSubjectType,
  mapOperationToVerificationEvents,
  fromExportLedger,
  fromLiveLedger,
} from "./verification/canonical.js";
export type {
  VerificationEvent,
  VerificationEventType,
  LiveLedger,
} from "./verification/canonical.js";
export {
  computeVerdict,
  verdictCore,
  verdictCoreBytes,
  VERDICT_SCHEMA_VERSION,
} from "./verification/verdict.js";
export type {
  Verdict,
  VerdictMetrics,
  VerdictWindow,
  VerdictSource,
} from "./verification/verdict.js";

// Backfill orchestration.
export { BackfillRunner, windowStartFor } from "./verification/backfill.js";
export type { BackfillOptions, BackfillResult } from "./verification/backfill.js";

// Live verifier (uses the same verdict engine).
export { LiveVerifier } from "./verification/liveVerifier.js";

// Persistence (sink + checkpoint) for resumable, idempotent backfill.
export {
  InMemoryVerdictSink,
  FileVerdictSink,
  InMemoryCheckpointStore,
  FileCheckpointStore,
  verdictKey,
} from "./verification/stores.js";
export type { VerdictSink, CheckpointStore, BackfillCheckpoint } from "./verification/stores.js";
