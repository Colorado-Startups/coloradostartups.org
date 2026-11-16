// GET /downloads/colorado-startups-skill.zip: the colorado-startups skill
// folder as a zip, to upload to claude.ai as a skill (step A6b). Prerendered
// into dist/ at build, like the /data/ files; nothing is written to the source tree.
import { skillZip } from "../../lib/skill-zip/skill";

export const prerender = true;

export function GET() {
  return new Response(new Uint8Array(skillZip()), {
    headers: { "Content-Type": "application/zip" },
  });
}
