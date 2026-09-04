export { SubscriptionService } from "./SubscriptionService.js";
export type { CreateSubscriptionInput, SubscriptionServiceOptions } from "./SubscriptionService.js";
export { SubscriptionError } from "./errors.js";
export type { SubscriptionErrorCode } from "./errors.js";
export { MemorySubscriptionStore } from "./store.js";
export type { SubscriptionStore } from "./store.js";
export type {
  SubscriptionAction,
  SubscriptionAuditEntry,
  SubscriptionRecord,
  SubscriptionStatus,
  SubscriptionTier,
} from "./types.js";
export type {
  CoverageReason,
  CoverageWindow,
  CoverageLedger,
  CoverageLedgerErrorCode,
} from "./coverage.js";
export {
  CoverageLedgerError,
  InMemoryCoverageLedger,
  assertValidCoverageWindow,
  isCoveredReason,
  wasCovered,
  coverageForWindow,
} from "./coverage.js";

export type {
  BillingHooks,
  SubscriptionEvent,
  ExpiringSubscriptionEvent,
  RecordedBillingCall,
} from "./billing.js";
export { NOOP_BILLING_HOOKS, RecordingBillingHooks } from "./billing.js";

export type {
  SubscriptionState,
  SubscriptionLifecycleErrorCode,
  BackstopSubscriptionConfig,
} from "./lifecycle.js";
export {
  BackstopSubscription,
  SubscriptionLifecycleError,
  LEGAL_TRANSITIONS,
  isCoveredState,
  isLegalTransition,
} from "./lifecycle.js";
