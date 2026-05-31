CREATE TABLE IF NOT EXISTS pulse_webhook_dead_letters (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  event JSONB NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS pulse_webhook_dead_letters_url_idx
  ON pulse_webhook_dead_letters (url);

CREATE INDEX IF NOT EXISTS pulse_webhook_dead_letters_failed_at_idx
  ON pulse_webhook_dead_letters (failed_at);
