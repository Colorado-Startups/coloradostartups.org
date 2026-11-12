-- L3 Canvas (range 0200-0299). Adds the two optional triage fields the
-- suggest-a-resource form asks for. The base table is in 0001_init.sql.
-- The suggested URL is stored as text and never fetched by any Worker; link
-- checks run offline in scripts/canvas/ when a suggestion is promoted.

ALTER TABLE resource_suggestions ADD COLUMN stage TEXT;   -- idea | launch | growth | support, or NULL
ALTER TABLE resource_suggestions ADD COLUMN city TEXT;    -- free text, max 60 characters
