// GET /data/regions.json: the three regions, their cities and the ids of the
// Startup Resources listings in each. The /mcp Worker reads it for the region
// tool and the region filter on resources (worker/mcp/data.ts).
import { activeCards } from "../../components/canvas/canvas-data";
import { jsonFile, openRegions } from "../../lib/data/open-data";
import { REGIONS } from "../../lib/regions/match";

export async function GET() {
  return jsonFile(openRegions(REGIONS, await activeCards()));
}
