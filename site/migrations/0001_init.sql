-- Wave 0 base schema. D1 holds inbound queues and counters only; public
-- content lives as files in data/ and ships through reviewed PRs.
--
-- No table stores an IP address. Migration ranges are reserved per lane so two
-- lanes never pick the same number:
--   0001-0099 orchestrator   0100-0199 L2 Leaderboard   0200-0299 L3 Canvas
--   0300-0399 L4 Resourcus   0400-0499 L5 Communitas    0500-0599 L6 Comms

-- Leaderboard nominations (L2 extends). Purpose limit: verification and
-- ranking only, never investment sourcing. Raw financials are deleted 90 days
-- after the edition they fed is published (see data/legal/privacy.md).
CREATE TABLE IF NOT EXISTS nominations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',          -- new | verifying | verified | declined
  payload TEXT NOT NULL,                       -- JSON validated by NominationSchema
  financials_deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nominations_status ON nominations (status);

-- Suggest-a-resource queue (L3 extends). Promoted to data/resources/ by PR.
CREATE TABLE IF NOT EXISTS resource_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',          -- new | accepted | declined
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT,
  submitter_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_resource_suggestions_status ON resource_suggestions (status);

-- Resourcus question log (L4 extends). Kept 90 days by default. caller_key is
-- a salted hash for Slack users and a random session id for the web.
CREATE TABLE IF NOT EXISTS ask_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  caller TEXT NOT NULL,                        -- web | slack
  caller_key TEXT,
  question TEXT NOT NULL,
  answer TEXT,
  citations TEXT,                              -- JSON array of resource ids
  mode TEXT NOT NULL,                          -- model | fallback
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ask_logs_created_at ON ask_logs (created_at);

-- Budget guard counters (L4 uses). One row per counter per period.
CREATE TABLE IF NOT EXISTS usage_counters (
  counter TEXT NOT NULL,                       -- model_calls | search_queries
  period TEXT NOT NULL,                        -- YYYY-MM
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (counter, period)
);

-- CSP violation reports, deduplicated by signature (ported from the sibling
-- site). blocked_uri is normalized to scheme+host and document_uri to a path,
-- so no query string is ever stored.
CREATE TABLE IF NOT EXISTS csp_reports (
  signature TEXT PRIMARY KEY,
  directive TEXT NOT NULL,
  blocked_uri TEXT NOT NULL,
  document_uri TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_csp_reports_first_seen ON csp_reports (first_seen);
