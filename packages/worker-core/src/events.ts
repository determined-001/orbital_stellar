import type { NormalizedEvent } from "@orbital-stellar/pulse-core";

/**
 * Event type for a worker that successfully fired.
 */
export type WorkerFiredEventType = "worker.fired";

/**
 * Event type for a worker that missed (failed to execute).
 */
export type WorkerMissedEventType = "worker.missed";

/**
 * A normalized worker-fired event.
 *
 * Emitted when a worker successfully executes its task within a time window.
 */
export type WorkerFiredEvent = {
  /** The type of worker event. */
  type: WorkerFiredEventType;
  /** Unique identifier for the worker. */
  workerId: string;
  /** The time window this execution belongs to (ISO 8601 interval or timestamp). */
  window: string;
  /** Transaction hash of the successful execution, when available. */
  txHash?: string;
  /** Ledger sequence number where the execution occurred, when available. */
  ledger?: number;
  /** ISO 8601 timestamp of the fire event. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record, when available. */
  raw?: unknown;
};

/**
 * Details about a failure in the execution chain.
 */
export type WorkerFailure = {
  /** Error message describing the failure. */
  error: string;
  /** ISO 8601 timestamp of when the failure occurred. */
  timestamp: string;
  /** Attempt number (1-indexed) when this failure occurred. */
  attempt: number;
};

/**
 * A normalized worker-missed event.
 *
 * Emitted when a worker fails to execute within a time window.
 * Fires once per window, not once per retry attempt.
 */
export type WorkerMissedEvent = {
  /** The type of worker event. */
  type: WorkerMissedEventType;
  /** Unique identifier for the worker. */
  workerId: string;
  /** The time window this miss belongs to (ISO 8601 interval or timestamp). */
  window: string;
  /** Ledger sequence number where the miss was detected, when available. */
  ledger?: number;
  /** The chain of failures that led to this miss. */
  failures: WorkerFailure[];
  /** ISO 8601 timestamp of the miss event. */
  timestamp: string;
  /** Lazy, cached `Date` derived from `event.timestamp`. Non-enumerable; does not appear in JSON.stringify output. */
  readonly timestampDate: Date;
  /** The original raw record, when available. */
  raw?: unknown;
};

/**
 * Discriminated union of all worker lifecycle events.
 */
export type WorkerEvent = WorkerFiredEvent | WorkerMissedEvent;

/**
 * Event type string for worker events.
 */
export type WorkerEventType = WorkerFiredEventType | WorkerMissedEventType;
