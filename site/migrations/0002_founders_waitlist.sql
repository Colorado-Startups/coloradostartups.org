-- The founders forum waitlist (step F1). /founders/ belongs to L1, which has
-- no range of its own in 0001_init.sql: by its scheme (L2 0100, L3 0200 ...)
-- L1 falls in 0001-0099, the orchestrator's range, where this is the second
-- migration.
--
-- /api/waitlist writes one row per email (site/worker/routes/waitlist.ts). A
-- second sign-up with the same email changes nothing. No notice email goes
-- out per sign-up, so the contact data lives here only, never in the repo, a
-- log or an inbox. The company website is stored as text and never fetched
-- (BRIEF constraint 12). No IP address is stored. A weekly job deletes each
-- row 365 days after created_at (WAITLIST_RETENTION_DAYS).
--
-- The CHECKs hold the validators of site/src/components/founders/
-- waitlist-fields.ts in the database itself, so a hand-typed statement cannot
-- break them; site/test/worker/waitlist.test.ts checks the two agree. A new
-- stage needs a table rebuild here.
CREATE TABLE IF NOT EXISTS founders_waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 120),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 120),
  email TEXT NOT NULL                          -- where the one opening email goes
    CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email) AND email LIKE '%_@_%'),
  company TEXT NOT NULL CHECK (length(company) BETWEEN 1 AND 160),
  company_website TEXT                         -- optional; an https link as text
    CHECK (company_website IS NULL OR (company_website LIKE 'https://%' AND length(company_website) <= 300)),
  stage TEXT
    CHECK (stage IS NULL OR stage IN ('idea', 'launch', 'growth')),
  founder INTEGER NOT NULL
    CHECK (founder = 1)                        -- the required "I am a founder or cofounder" box
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_founders_waitlist_email ON founders_waitlist (email);
