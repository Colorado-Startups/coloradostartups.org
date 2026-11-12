// True in the private archive repo, false in the public export. The archive
// marker (04_tools/.private-overlay-required) is the same path that
// scripts/people/overlay.mjs exports as ARCHIVE_MARKER. A test that reads a
// file the export leaves out (art/runs, art/workflows, ops, 00_project_system,
// quality) skips when this is false.
import { existsSync } from "node:fs";

export const IN_ARCHIVE = existsSync(new URL("../../04_tools/.private-overlay-required", import.meta.url));
