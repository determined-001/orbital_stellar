-- Migration: create cursor_store table for PostgresCursorStore
CREATE TABLE IF NOT EXISTS cursor_store (
    stream_key TEXT PRIMARY KEY,
    cursor TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
