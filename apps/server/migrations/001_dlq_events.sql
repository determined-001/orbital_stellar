-- DLQ table for failed webhook deliveries
CREATE TABLE IF NOT EXISTS dlq_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address     TEXT        NOT NULL,
  url         TEXT        NOT NULL,
  attempts    INTEGER     NOT NULL,
  last_error  TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replayed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS dlq_events_created_at_idx ON dlq_events (created_at DESC);
