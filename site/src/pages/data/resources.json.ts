// GET /data/resources.json: the build-time list of active ResourceCards,
// sorted by id. Owner: L3. The Worker reads it through the ASSETS binding for
// the keyword fallback, and Communitas's Slack fallback reaches it the same way
// through ResourcusRPC. When the file is empty or missing, production answers
// with no cards; only the tests may use the Worker's fixture
// (worker/resourcus/answer.ts, decision 38).
import { activeCards } from "../../components/canvas/canvas-data";

export async function GET() {
  const cards = (await activeCards()).sort((a, b) => a.id.localeCompare(b.id));
  return new Response(JSON.stringify(cards), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
