-- Migration 001: Create retry queue table for PostgresRetryQueue
CREATE TABLE IF NOT EXISTS orbital_retry_queue (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  event JSONB NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
  locked_until TIMESTAMP WITH TIME ZONE
);

-- Index for fast due-job selection and scheduling
CREATE INDEX IF NOT EXISTS idx_orbital_retry_queue_lookup 
ON orbital_retry_queue (next_attempt_at, locked_until)
WHERE (locked_until IS NULL OR locked_until < NOW());
