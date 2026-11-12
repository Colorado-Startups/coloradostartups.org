-- L4 Resourcus. Range 0300-0399 (see 0001_init.sql).
--
-- 1. ask_sessions: Turnstile once per web session. One row per verified
--    session, keyed by a SHA-256 of the random session id (never the id
--    itself). Rows older than a day are purged with ask_logs.
-- 2. ask_logs gains the model that answered and the citation ids the server
--    dropped, so groundedness can be watched in production. No IP column.

CREATE TABLE IF NOT EXISTS ask_sessions (
  session_hash TEXT PRIMARY KEY,
  verified_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ask_sessions_verified_at ON ask_sessions (verified_at);

ALTER TABLE ask_logs ADD COLUMN model TEXT;
ALTER TABLE ask_logs ADD COLUMN dropped_citations TEXT;  -- JSON array of ids the model wrote but retrieval did not return
