// GET /data/events.json: the calendar's events that had not ended when the
// site was built, soonest first, each with its region. The same list as
// /event-calendar/ (components/events/events.ts). The /mcp Worker reads it
// through the ASSETS binding (worker/mcp/data.ts).
import { SNAPSHOT, upcomingEvents } from "../../components/events/events";
import { jsonFile, openEvents } from "../../lib/data/open-data";

export function GET() {
  return jsonFile(openEvents(upcomingEvents(SNAPSHOT, new Date())));
}
