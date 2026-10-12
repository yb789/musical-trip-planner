// Reads the planner's own live schedule (api/schedule.js) in-process, so server-rendered pages
// show exactly what visitors see in the planner. Same approach as lib/guide-check.js.
import scheduleHandler from "../api/schedule.js";

const SOURCE = { london: "london", "new-york": "broadway" };
const iso = d => d.toISOString().slice(0, 10);

// Returns { start, end, refreshedAt, shows: [{ name, venue }], schedule: { "YYYY-MM-DD": [[name, "HH:MM"], ...] } }
export async function loadSchedule(citySlug, start, days = 7) {
  const city = SOURCE[citySlug];
  if (!city) throw new Error(`unknown city ${citySlug}`);
  const end = new Date(start.getTime() + (days - 1) * 86400000);
  let body = null, status = 0;
  const res = {
    status(s) { status = s; return res; },
    setHeader() { return res; },
    end(text) { body = text; return res; }
  };
  await scheduleHandler({ method: "GET", query: { city, start: iso(start), end: iso(end) } }, res);
  const j = body ? JSON.parse(body) : {};
  if (status !== 200) throw new Error(j.error || `schedule ${status}`);
  return { start: iso(start), end: iso(end), refreshedAt: j.refreshedAt || new Date().toISOString(), shows: j.shows || [], schedule: j.schedule || {} };
}
