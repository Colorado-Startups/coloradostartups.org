// True in the private archive repo, false in the public export. The archive
// marker (04_tools/.private-overlay-required) is the same path that
// scripts/people/overlay.mjs exports as ARCHIVE_MARKER. A test that reads a
// file the export leaves out (art/runs, art/workflows, ops, 00_project_system,
// quality) skips when this is false.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A path string, not a URL: under jsdom the global URL is jsdom's, which node:fs does not accept.
export const IN_ARCHIVE = existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../04_tools/.private-overlay-required"));
