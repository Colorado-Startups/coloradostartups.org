// GET /maps/colorado.svg and /maps/<region>.svg: each map as one standalone
// SVG file (lib/regions/map-file.ts), for a README or any page that shows it
// with an <img>. Built with the site, so it follows the zones.
import { REGION_IDS, type RegionId } from "@cs/shared";

import { mapFileSvg } from "../../lib/regions/map-file";

export function getStaticPaths() {
  return [{ params: { view: "colorado" } }, ...REGION_IDS.map((id) => ({ params: { view: id } }))];
}

export function GET({ params }: { params: { view: string } }) {
  const zone = params.view === "colorado" ? undefined : (params.view as RegionId);
  return new Response(mapFileSvg(zone), { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}
