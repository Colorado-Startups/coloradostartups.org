-- L19 seat applications. The orchestrator assigned 0400 to this lane on
-- 2026-10-18. 0001_init.sql reserved 0400-0499 for L5, which keeps no
-- migrations in this folder.
--
-- /api/apply writes one row per application (site/worker/routes/apply.ts).
-- Contact data lives here and nowhere else: never in the repo, a log or an
-- email. Links are stored as text and never fetched (BRIEF constraint 12).
-- After Paul decides, the applicant's fields are set to NULL and only the
-- seat, the dates and the outcome stay (ops/runbooks/promote-submissions.md,
-- Applications). That is why every applicant field is nullable.
--
-- The CHECKs hold three rules in the database itself, so a hand-typed UPDATE
-- cannot break them: role is one of APPLY_ROLE_IDS (packages/shared/src/
-- apply.ts; site/test/unit/l19 checks the two lists match, and a new seat
-- needs a table rebuild here), badges is JSON, and a decided row keeps no
-- applicant field.
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'reviewing', 'accepted', 'declined')),
  role TEXT NOT NULL
    CHECK (role IN ('slack-community-lead', 'photon-mountain-connector', 'fusion-canyon-connector', 'space-peak-connector')),
  name TEXT,
  email TEXT,
  based_in TEXT,
  linkedin TEXT,                               -- https link as text, or NULL
  why TEXT,
  badges TEXT CHECK (badges IS NULL OR json_valid(badges)), -- JSON object: course id -> verification link
  anything_else TEXT,
  consent_at TEXT NOT NULL,                    -- when the applicant ticked the consent box
  decided_at TEXT,                             -- set with status accepted or declined
  contact_deleted_at TEXT,                     -- set when the applicant fields are cleared
  CHECK (
    status IN ('new', 'reviewing')
    OR (name IS NULL AND email IS NULL AND based_in IS NULL AND linkedin IS NULL
        AND why IS NULL AND badges IS NULL AND anything_else IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
