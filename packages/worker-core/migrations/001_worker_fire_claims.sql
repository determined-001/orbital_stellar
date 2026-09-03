CREATE TABLE IF NOT EXISTS worker_fire_claims (
  fire_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS worker_fire_claims_expires_at_idx
  ON worker_fire_claims (expires_at);