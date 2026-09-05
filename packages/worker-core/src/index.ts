export {
  fireKeyToString,
  InMemoryClaimStore,
  IdempotencyManager,
  PostgresClaimStore,
} from "./idempotency.js";
export type { ClaimRecord, ClaimStore, FireKey } from "./idempotency.js";
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
// Latency-tier configuration (issue #1064). Same module as the enable decision
// above: the tier table derives `latency-sensitive`'s registrability from it.
export {
  TIERS,
  guaranteeDeadline,
  registrableTiers,
  tierDefinition,
  withinGuarantee,
} from "./backstop/index.js";
export type { GuaranteeBounds, TierDefinition, TierId } from "./backstop/index.js";
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
export { BackfillRunner, windowStartFor } from "./verification/backfill.js";
export type { BackfillOptions, BackfillResult } from "./verification/backfill.js";
export { LiveVerifier } from "./verification/liveVerifier.js";
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
export type {
  PriceReading,
  StalenessBound,
  DeviationBound,
  PriceGuardConfig,
  PriceGuardVerdict,
  GuardTripRecord,
  ReenableRecord,
  CircuitBreakerState,
  CircuitBreakerConfig,
} from "./guards/index.js";
export {
  checkStaleness,
  checkDeviation,
  checkPriceGuard,
  CircuitBreaker,
  CircuitBreakerNotOpenError,
} from "./guards/index.js";
/*
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

export type {
  PriceReading,
  StalenessBound,
  DeviationBound,
  PriceGuardConfig,
  PriceGuardVerdict,
  GuardTripRecord,
  ReenableRecord,
  CircuitBreakerState,
  CircuitBreakerConfig,
} from "./guards/index.js";
export {
  checkStaleness,
  checkDeviation,
  checkPriceGuard,
  CircuitBreaker,
  CircuitBreakerNotOpenError,
} from "./guards/index.js";
*/

// Worker fire/miss notifications (issue #1046).
export type {
  WorkerEvent,
  WorkerEventType,
  WorkerFiredEvent,
  WorkerFiredEventType,
  WorkerMissedEvent,
  WorkerMissedEventType,
  WorkerFailure,
} from "./events.js";
export { WorkerNotifier } from "./notify.js";
export type { WorkerNotifyConfig } from "./notify.js";

// Operator reputation (issue #1051).
// Named rather than star re-exports: `Verdict` and `OperatorScore` already exist
// on this barrel (verification/verdict.js, backstop/slo.js), so a star export
// would be silently shadowed. The reputation shapes are aliased instead.
export { selectWindow, computeWindowMetrics, percentile } from "./reputation/window.js";
export type {
  VerdictOutcome,
  WindowSelection,
  WindowMetrics,
  Verdict as ReputationVerdict,
} from "./reputation/window.js";
export {
  SCORE_FORMULA_VERSION,
  DEFAULT_WEIGHTS,
  scoreOperator,
  attributableDrop,
} from "./reputation/score.js";
export type {
  ScoreConfig,
  ScoreContributorReason,
  ScoreContributor,
  InsufficientDataScore,
  ScoredScore,
  OperatorScore as OperatorReputationScore,
} from "./reputation/score.js";
// Worker state store: core interface, types and schema version.
export {
  WorkerStateStore,
  WORKER_STATE_SCHEMA_VERSION,
  type WorkerStateSchemaVersion,
  type WorkerState,
  type WorkerFireRecord,
  type WorkerClaimRecord,
  type RegisterWorkerInput,
  type AppendFireRecordInput,
  type WriteClaimInput,
  type ReleaseClaimInput,
  type WorkerStateStoreLike,
} from "./WorkerStateStore.js";

// Worker state store backends.
export { MemoryWorkerStateStore } from "./MemoryWorkerStateStore.js";
export {
  FileWorkerStateStore,
  type Logger as FileWorkerStateStoreLogger,
} from "./FileWorkerStateStore.js";
export { PostgresWorkerStateStore, type PgLike } from "./PostgresWorkerStateStore.js";
export { RedisWorkerStateStore, type RedisLike } from "./RedisWorkerStateStore.js";

// Worker state store migration helper.
export { migrateWorkerState, type MigrateWorkerStateResult } from "./migrateWorkerState.js";
export type {
  CronTrigger,
  TriggerSpec,
  ParamSpec,
  TargetSpec,
  LatencyBound,
  TopicMatcher,
  DataFieldSpec,
  FireEventSpec,
  WorkerManifest,
  ManifestSchemaVersion,
  ManifestValidationIssue,
  ValidationResult,
} from "./manifest.js";
export {
  MANIFEST_SCHEMA_VERSION,
  WorkerManifestBuilder,
  ManifestValidationError,
  validateManifest,
  parseManifest,
} from "./manifest.js";

// Subscription model and subscriber webhooks (issue #1059).
// Named rather than a star re-export, matching the convention above: a star
// export here would silently shadow if a name is ever added on both sides.
export { SubscriptionService } from "./subscription/index.js";
export type { CreateSubscriptionInput, SubscriptionServiceOptions } from "./subscription/index.js";
export { SubscriptionError } from "./subscription/index.js";
export type { SubscriptionErrorCode } from "./subscription/index.js";
export { MemorySubscriptionStore } from "./subscription/index.js";
export type { SubscriptionStore } from "./subscription/index.js";
export type {
  SubscriptionAction,
  SubscriptionAuditEntry,
  SubscriptionRecord,
  SubscriptionStatus,
  SubscriptionTier,
} from "./subscription/index.js";

// Event-based trigger class (issue #1060).
// The class is exported as `EventTriggerPlanner`: `EventTrigger` is already the
// name of the `Trigger` union's event member in ./types.js, and a barrel cannot
// carry both. The planner is the thing that turns events into fire decisions;
// the type is the thing a worker definition holds.
export {
  EventTriggerPlanner,
  InMemoryFireClaimStore,
  ClaimStoreFireClaims,
  eventIdentity,
  registerEventTrigger,
} from "./triggers/eventTrigger.js";
export type {
  EventTriggerDefinition,
  FireClaimStore,
  FireDecision,
  PlanResult,
  RegisterResult,
  SkipReason,
  SkippedEvent,
} from "./triggers/eventTrigger.js";
export { TRADE_SIGNAL_REJECTION, compileEventCondition } from "./triggers/predicate.js";
export type { CompileResult, EventConditionSpec, EventPredicate } from "./triggers/predicate.js";
// Backstop readiness cost metering (issue #1063).
export type {
  CostBreakdown,
  CostMeter,
  CostWindow,
  CostMeterErrorCode,
  MarginalCostEstimate,
  MarginalCostReport,
  SubscriptionArrival,
} from "./backstop/costMeter.js";
export {
  NOOP_COST_METER,
  InMemoryCostMeter,
  CostMeterError,
  emptyCostBreakdown,
} from "./backstop/costMeter.js";
export { PrometheusCostMeter, OtelCostMeter, CompositeCostMeter } from "./metrics.js";
export type {
  Meter as CostMeterOtelMeter,
  OtelCounter as CostMeterOtelCounter,
} from "./metrics.js";
// Backstop subscription lifecycle, coverage ledger and billing hooks (issue #1067).
export type {
  CoverageReason,
  CoverageWindow,
  CoverageLedger,
  CoverageLedgerErrorCode,
  BillingHooks,
  SubscriptionEvent,
  ExpiringSubscriptionEvent,
  RecordedBillingCall,
  SubscriptionState,
  SubscriptionLifecycleErrorCode,
  BackstopSubscriptionConfig,
} from "./subscription/index.js";
export {
  CoverageLedgerError,
  InMemoryCoverageLedger,
  assertValidCoverageWindow,
  isCoveredReason,
  wasCovered,
  coverageForWindow,
  NOOP_BILLING_HOOKS,
  RecordingBillingHooks,
  BackstopSubscription,
  SubscriptionLifecycleError,
  LEGAL_TRANSITIONS,
  isCoveredState,
  isLegalTransition,
} from "./subscription/index.js";
// Fee-bump paymaster (issue #1044).
export { Paymaster, SelfWrapError, InvalidInnerTransactionError } from "./Paymaster.js";
export type { PaymasterConfig, BumpInput, BumpResult } from "./Paymaster.js";
export {
  SponsorshipPolicy,
  RateLimitedError,
  FeeTooHighError,
  FloatExhaustedError,
} from "./sponsorshipPolicy.js";
export type { SponsorshipPolicyConfig } from "./sponsorshipPolicy.js";

// Transaction builder and submitter (issue #1040).
export { TxSubmitter } from "./TxSubmitter.js";
export type { SubmissionOutcome, TxSubmitterOptions } from "./TxSubmitter.js";
export { OperatorSigner, NETWORK_PASSPHRASE, redactSecret } from "./OperatorSigner.js";
export {
  resolveFee,
  FeeCapExceededError,
  InvalidFeeConfigError,
  BASE_FEE_STROOPS,
  DEFAULT_FEE_MULTIPLIER,
  DEFAULT_MAX_FEE_STROOPS,
  MAX_FEE_MULTIPLIER,
} from "./fees.js";
export type { FeeConfig, ResolvedFee } from "./fees.js";
