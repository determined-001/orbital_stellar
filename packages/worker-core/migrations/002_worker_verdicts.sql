-- Migration: 002_worker_verdicts
-- Schema version: 1
-- Introduces the table that backs PostgresWorkerVerdictStore (issue #1050,
-- "19.2 Verdict store and wire schema").
--
-- Safe to CREATE IF NOT EXISTS, so this migration is idempotent and can be
-- run from multiple processes concurrently without error, matching
-- 001_worker_state_store.sql's convention.

-- ─────────────────────────────────────────────────────────────────────────────
-- worker_verdicts  (append-only)
--    One row per verdict record. A window that is later corrected gets a
--    second row whose supersedes points at the first, rather than an
--    UPDATE - see the trigger below, which enforces that at the database
--    level the same way 001's worker_fire_history trigger does.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_verdicts (
    record_id          TEXT        PRIMARY KEY,
    schema_version     INTEGER     NOT NULL,
    window_id          TEXT        NOT NULL,
    worker_id          TEXT        NOT NULL,
    operator           TEXT        NOT NULL,
    condition_ledger   BIGINT      NOT NULL,
    deadline_ledger    BIGINT      NOT NULL,
    status             TEXT        NOT NULL CHECK (status IN ('fired', 'missed', 'late', 'not-due')),
    invocation_ledger  BIGINT,
    invocation_tx_hash TEXT,
    latency_ledgers    BIGINT,
    engine_version     TEXT        NOT NULL,
    recorded_at        TIMESTAMPTZ NOT NULL,
    supersedes         TEXT        REFERENCES worker_verdicts(record_id),
    correction_reason  TEXT
);

-- getLatestForWindow / getHistoryForWindow
CREATE INDEX IF NOT EXISTS worker_verdicts_window_id_recorded_at_idx
    ON worker_verdicts (window_id, recorded_at ASC);

-- queryByWorker, bounded by ledger range
CREATE INDEX IF NOT EXISTS worker_verdicts_worker_id_ledger_idx
    ON worker_verdicts (worker_id, condition_ledger, deadline_ledger);

-- queryByOperator, bounded by ledger range
CREATE INDEX IF NOT EXISTS worker_verdicts_operator_ledger_idx
    ON worker_verdicts (operator, condition_ledger, deadline_ledger);

-- queryByLedgerRange across every worker
CREATE INDEX IF NOT EXISTS worker_verdicts_ledger_range_idx
    ON worker_verdicts (condition_ledger, deadline_ledger);

-- Trigger function: reject UPDATE and DELETE on worker_verdicts. A verdict
-- is corrected by INSERTing a new row with `supersedes` set, never by
-- mutating the row it corrects - the property that makes a stored verdict
-- explainable as an engine change rather than tampering.
CREATE OR REPLACE FUNCTION worker_verdicts_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION
        'worker_verdicts is append-only: UPDATE and DELETE are not permitted (record_id=%)',
        COALESCE(OLD.record_id, '?');
END;
$$;

DROP TRIGGER IF EXISTS worker_verdicts_append_only_trigger ON worker_verdicts;
CREATE TRIGGER worker_verdicts_append_only_trigger
    BEFORE UPDATE OR DELETE ON worker_verdicts
    FOR EACH ROW EXECUTE FUNCTION worker_verdicts_append_only();
