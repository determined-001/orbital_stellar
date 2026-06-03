-- Migration 001: Create retry_queue table for PostgresRetryQueue
--
-- Up
CREATE TABLE IF NOT EXISTS retry_queue (
  id            TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  webhook_id    TEXT NOT NULL,
  payload       JSONB NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  url           TEXT NOT NULL,
  event         JSONB NOT NULL,
  attempt       INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  metadata      JSONB
);

-- Index for dequeue: find due records in chronological order
CREATE INDEX IF NOT EXISTS idx_retry_queue_next_retry_at
  ON retry_queue (next_retry_at ASC);

-- Index for evictNewest: find the most recently inserted record
CREATE INDEX IF NOT EXISTS idx_retry_queue_created_at
  ON retry_queue (created_at DESC);

-- Down
-- DROP TABLE IF EXISTS retry_queue;
