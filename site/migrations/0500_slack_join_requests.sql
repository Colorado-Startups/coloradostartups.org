-- Slack join requests (step P5a). 0001_init.sql reserves 0500-0599 for L6
-- Comms, which owns the Slack sign-up; this is the range's first migration.
--
-- /api/join writes one row per request (site/worker/routes/join.ts). Paul
-- reads each request, decides by hand and sends the Slack invite himself.
-- Contact data lives here and in his one notice email, never in the repo or
-- a log. The LinkedIn link is stored as text and never fetched (BRIEF
-- constraint 12). No IP address is stored.
--
-- The CHECKs hold the choice ids of site/src/components/join/fields.ts in the
-- database itself, so a hand-typed UPDATE cannot break them;
-- site/test/worker/join.test.ts checks the two lists match. A new choice
-- needs a table rebuild here.
CREATE TABLE IF NOT EXISTS slack_join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'invited', 'declined')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,                         -- where the Slack invite goes
  linkedin TEXT NOT NULL,                      -- https linkedin.com link as text
  based TEXT NOT NULL
    CHECK (based IN ('colorado', 'connected', 'other')),
  city TEXT,                                   -- required by the form when based = 'colorado'
  describes TEXT NOT NULL
    CHECK (describes IN ('founder', 'operator', 'investor-active', 'investor-interested',
                         'service-provider', 'supporter', 'student', 'other')),
  heard TEXT
    CHECK (heard IS NULL OR heard IN ('referral', 'linkedin', 'event', 'search', 'other')),
  newsletter INTEGER NOT NULL DEFAULT 0
    CHECK (newsletter IN (0, 1)),              -- 1 only when the person ticked the box
  decided_at TEXT,                             -- set with status invited or declined
  CHECK (based <> 'colorado' OR (city IS NOT NULL AND city <> ''))
);
CREATE INDEX IF NOT EXISTS idx_slack_join_requests_status ON slack_join_requests (status);
