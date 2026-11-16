-- "Get featured" requests (step P3a). Founder spotlights belong to the home
-- page, which has no lane range of its own in 0001_init.sql: like the founders
-- waitlist (0002), it falls in 0001-0099, the orchestrator's range, where
-- this is the third migration.
--
-- /api/spotlight writes one row per request (site/worker/routes/spotlight.ts).
-- Paul reads each request, decides by hand and replies himself. Nothing here
-- is public: a published spotlight is a reviewed file in data/spotlights/
-- (step P3b). Contact data lives here and in his one notice email, never in
-- the repo or a log. The website and LinkedIn link are stored as text and
-- never fetched (BRIEF constraint 12). No IP address is stored. A weekly job
-- deletes each row 180 days after created_at, whatever its status
-- (SPOTLIGHT_RETENTION_DAYS).
--
-- No consent, no row: both boxes are CHECK (= 1), and consent_at and
-- consent_version record when and to which wording of
-- site/src/components/spotlight/fields.ts SPOTLIGHT_CONSENT the person
-- agreed. The other CHECKs hold that file's validators in the database
-- itself, so a hand-typed statement cannot break them;
-- site/test/worker/spotlight.test.ts checks the two agree.
CREATE TABLE IF NOT EXISTS spotlight_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'published', 'declined')),
  decided_at TEXT,                             -- set with status published or declined
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 120),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 120),
  email TEXT NOT NULL                          -- where Paul replies; never shown
    CHECK (length(email) BETWEEN 3 AND 254 AND email LIKE '%_@_%'),
  role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 80),
  company TEXT NOT NULL CHECK (length(company) BETWEEN 1 AND 160),
  company_website TEXT NOT NULL                -- an https link as text
    CHECK (company_website LIKE 'https://%' AND length(company_website) <= 300),
  city TEXT NOT NULL CHECK (length(city) BETWEEN 1 AND 80),
  building TEXT NOT NULL CHECK (length(building) BETWEEN 1 AND 140),
  -- Optional. An https link whose host (the text between https:// and the
  -- first slash) is linkedin.com or a subdomain of it, with a path after it.
  linkedin TEXT CHECK (linkedin IS NULL OR (
    length(linkedin) <= 300
    AND linkedin LIKE 'https://%/_%'
    AND substr(linkedin, 9, instr(substr(linkedin, 9), '/') - 1) NOT GLOB '*[^A-Za-z0-9.-]*'
    AND (substr(linkedin, 9, instr(substr(linkedin, 9), '/') - 1) LIKE 'linkedin.com'
         OR substr(linkedin, 9, instr(substr(linkedin, 9), '/') - 1) LIKE '%_.linkedin.com')
    AND length(linkedin) > 9 + length(substr(linkedin, 9, instr(substr(linkedin, 9), '/') - 1))
  )),
  founder INTEGER NOT NULL
    CHECK (founder = 1),                       -- "I am a founder or cofounder of this company."
  consent_show INTEGER NOT NULL
    CHECK (consent_show = 1),                  -- "Colorado Startups may show my name, role, ..."
  consent_at TEXT NOT NULL,                    -- when the person sent both boxes ticked
  consent_version TEXT NOT NULL                -- SPOTLIGHT_CONSENT_VERSION of that wording
    CHECK (length(consent_version) BETWEEN 1 AND 40),
  CHECK ((status = 'new') = (decided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_spotlight_requests_status ON spotlight_requests (status);
