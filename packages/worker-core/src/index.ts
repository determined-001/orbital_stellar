export type {
  Network,
  ChainState,
  ArgBuilder,
  IntervalSchedule,
  CronSchedule,
  Schedule,
  TimeTrigger,
  EventTrigger,
  ComputationTrigger,
  Trigger,
  FeeBumpPolicy,
  WorkerDefinition,
} from "./types.js";

export { TriggerNotImplementedError, assertImplementedTrigger } from "./types.js";

export type {
  LatencyBudget,
  StaticHotPathPlan,
  DynamicHotPathPlan,
  HotPathPlan,
  HotStandbyConfig,
  LatencyScorecardEntry,
} from "./hotPath/index.js";
export {
  isPreSignable,
  recordScorecardEntry,
  HotPathNotImplementedError,
  assertHotPathReady,
} from "./hotPath/index.js";

export type { CostMeasurement, TierEnableDecision } from "./backstop/tiers.js";
export {
  LATENCY_SENSITIVE_TIER_DEFAULT,
  TierEnableWithoutMeasurementError,
  assertTierEnableDecisionIsValid,
} from "./backstop/tiers.js";
export {
  classifySubmissionError,
  isRetryableSubmissionFailure,
  type SubmissionFailure,
  type SubmissionFailureKind,
} from "./errors.js";

export {
  RetryPolicy,
  MemoryWorkerRetryQueue,
  FileWorkerRetryQueue,
  makeRetryRecord,
  type RetryPolicyConfig,
  type RetryDecision,
  type SubmissionHandle,
  type WorkerRetryQueue,
  type WorkerRetryRecord,
  type MemoryWorkerRetryQueueOptions,
  type FileWorkerRetryQueueOptions,
} from "./retry.js";

export {
  MemoryWorkerDeadLetterStore,
  type WorkerDeadLetterStore,
  type WorkerDeadLetterEntry,
  type WorkerDeadLetterInput,
  type WorkerDeadLetterFilter,
  type WorkerReplayHandler,
  type MemoryWorkerDeadLetterStoreOptions,
} from "./WorkerDeadLetterStore.js";

export type {
  VaultConfig,
  VaultExecutionRequest,
  VaultExecutionResult,
  VaultClient,
} from "./vault/index.js";
export { VaultNotImplementedError, UNIMPLEMENTED_VAULT_CLIENT } from "./vault/index.js";

export type {
  ObservedTrade,
  CopyTradeSkipReason,
  CopyTradeSkipRecord,
  CopyTradeOutcome,
  RevocationCheck,
  CopyTradeWorkerConfig,
} from "./workers/index.js";
export { createCopyTradeTrigger, computeMirroredSize, planCopyTrade } from "./workers/index.js";

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

export {
  ORBITAL_BACKSTOP_OPERATOR_ID,
  BackstopSloError,
  evaluateBackstopSlo,
} from "./backstop/slo.js";
export type {
  BackstopSloBounds,
  BackstopSloErrorCode,
  BackstopSloResult,
  EvaluateBackstopSloInput,
  OperatorScore,
  OperatorScorer,
  SloStatus,
  WorkerVerdictStore,
  WorkerWindowStatus,
  WorkerWindowVerdict,
} from "./backstop/slo.js";

export { WorkerRegistryClient, LocalWorkerRegistry } from "./registry/index.js";
export type { WorkerRegistryClientConfig } from "./registry/index.js";
