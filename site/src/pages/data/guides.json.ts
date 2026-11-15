// GET /data/guides.json: every guide under /guides/, with its answer as plain
// text and, for a city guide, its region. The /mcp Worker searches it.
import { guideInput } from "../../components/guides/guide-data";
import { openGuide, jsonFile } from "../../lib/data/open-data";
import { CREDITS_GUIDE } from "../../lib/guides/credits";
import { buildGuide, CITY_GUIDES, GUIDE_SLUGS, plainText } from "../../lib/guides/guides";

export async function GET() {
  const input = await guideInput();
  const cities: Partial<Record<string, string>> = CITY_GUIDES;
  const guides = GUIDE_SLUGS.map((slug) => {
    const g = buildGuide(slug, input);
    return openGuide({ ...g, answer: plainText(g.answer) }, cities[slug]);
  });
  guides.push(openGuide({ slug: "startup-credits", ...CREDITS_GUIDE, answer: CREDITS_GUIDE.description }, undefined));
  return jsonFile(guides.sort((a, b) => a.id.localeCompare(b.id)));
}
