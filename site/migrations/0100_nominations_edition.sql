-- L2 Leaderboard. Links a nomination to the verified edition it fed, so the
-- 90-day deletion of raw financials can find every row for that edition
-- (ops/runbooks/promote-submissions.md, Nominations). NULL until Paul assigns
-- the row to an edition.
ALTER TABLE nominations ADD COLUMN edition_id TEXT;
CREATE INDEX IF NOT EXISTS idx_nominations_edition ON nominations (edition_id);
