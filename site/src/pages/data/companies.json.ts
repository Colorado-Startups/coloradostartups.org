// GET /data/companies.json: the latest Leaderboard edition's honorees, one
// record per company, sorted by id, each with its boards and region. The /mcp
// Worker reads it through the ASSETS binding (worker/mcp/data.ts).
import { getCollection } from "astro:content";

import { openCompanies, jsonFile } from "../../lib/data/open-data";
import { buildBoard, latestEdition } from "../../lib/leaderboard/board";

export async function GET() {
  const companies = (await getCollection("companies")).map((e) => e.data);
  const edition = latestEdition((await getCollection("editions")).map((e) => e.data));
  return jsonFile(edition ? openCompanies(buildBoard(edition, companies)) : []);
}
