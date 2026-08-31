-- Migration: 001_worker_state_store
-- Schema version: 1
-- Introduces the three tables that back PostgresWorkerStateStore.
--
-- All tables are safe to CREATE IF NOT EXISTS, so this migration is
-- idempotent and can be run from multiple processes concurrently without
-- error (Postgres serialises DDL changes with ShareLock).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Worker registrations
--    One row per worker. Holds the mutable scalar fields: last-fired window
--    and metadata. Fire history and claims live in separate tables.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_registrations (
    worker_id                 TEXT        PRIMARY KEY,
    registered_at             TIMESTAMPTZ NOT NULL,
    updated_at                TIMESTAMPTZ NOT NULL,
    last_fired_window_start   TIMESTAMPTZ,
    last_fired_window_end     TIMESTAMPTZ,
    metadata                  JSONB       NOT NULL DEFAULT '{}'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Fire history  (append-only)
--    Each row is one fired window.  A BEFORE UPDATE OR DELETE trigger
--    prevents any row from being modified or removed, enforcing the
--    append-only contract at the database level independently of application
--    code.  This guarantees the integrity of phase-19 reputation inputs even
--    if application code is buggy or a direct SQL connection is used.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_fire_history (
    id          BIGSERIAL   PRIMARY KEY,
    worker_id   TEXT        NOT NULL REFERENCES worker_registrations(worker_id),
    window_start TIMESTAMPTZ NOT NULL,
    window_end   TIMESTAMPTZ NOT NULL,
    fired_at    TIMESTAMPTZ NOT NULL,
    payload     JSONB
);

CREATE INDEX IF NOT EXISTS worker_fire_history_worker_id_fired_at_idx
    ON worker_fire_history (worker_id, fired_at ASC);

-- Trigger function: reject UPDATE and DELETE on worker_fire_history
CREATE OR REPLACE FUNCTION worker_fire_history_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'worker_fire_history is append-only: UPDATE and DELETE are not permitted (worker_id=%, id=%)',
        COALESCE(OLD.worker_id::TEXT, '?'),
        COALESCE(OLD.id::TEXT, '?');
END;
$$;

-- Attach the trigger (CREATE OR REPLACE is not supported for triggers; use
-- DROP IF EXISTS + CREATE to keep this migration idempotent).
DROP TRIGGER IF EXISTS worker_fire_history_no_mutate ON worker_fire_history;
CREATE TRIGGER worker_fire_history_no_mutate
    BEFORE UPDATE OR DELETE ON worker_fire_history
    FOR EACH ROW EXECUTE FUNCTION worker_fire_history_append_only();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Active claims
--    At most one active claim per (worker_id, window_id) pair, enforced by
--    the UNIQUE constraint.  The application upserts on conflict (renew).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_claims (
    worker_id   TEXT        NOT NULL REFERENCES worker_registrations(worker_id),
    window_id   TEXT        NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    CONSTRAINT worker_claims_pk PRIMARY KEY (worker_id, window_id)
);

CREATE INDEX IF NOT EXISTS worker_claims_expires_at_idx
    ON worker_claims (expires_at ASC);
