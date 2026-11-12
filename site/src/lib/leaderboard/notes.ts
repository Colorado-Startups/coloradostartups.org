// Public notes per company (data/leaderboard/notes.yaml). CompanySchema has no
// note field, and changing a shared schema goes through the orchestrator, so
// the notes live in their own L2 file. Read at build time.
import { parse } from "yaml";

import notesYaml from "../../../../data/leaderboard/notes.yaml?raw";

// Reads notes.yaml into company id -> note, trimmed. Throws on a note that is
// missing, empty or not text, so a bad entry fails the build.
export function parseNotes(text: string): Record<string, string> {
  const raw = (parse(text) ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [id, note] of Object.entries(raw)) {
    if (typeof note !== "string" || note.trim() === "") throw new Error(`notes.yaml: "${id}" needs a text note`);
    out[id] = note.trim();
  }
  return out;
}

export const COMPANY_NOTES: Readonly<Record<string, string>> = parseNotes(notesYaml);
