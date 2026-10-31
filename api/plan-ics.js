import { loadPlan, isValidCode, cityShort, rangeLabel } from "../lib/plans.js";
import { guideEntryFor } from "../lib/site-pages.js";
import { buildIcs, runtimeMinutes } from "../lib/ics.js";

// Calendar file for a shared plan. Reached through the vercel.json rewrite
//   /plan/:code/calendar.ics -> /api/plan-ics?code=:code
// One event per chosen performance, in the theatre's time zone, with the guide's runtime
// (2h 30m when unknown) and the ticket link in the description.
const CITY_SLUG = { london: "london", broadway: "new-york" };

function partOf(g, sess, date) {
  if (!g || g.parts !== 2) return "";
  if (sess === "morning" || sess === "matinee") return "Part One";
  return new Date(date + "T12:00:00Z").getUTCDay() === 4 ? "Part One" : "Part Two";
}

export default async function handler(req, res) {
  const code = String(req.query.code || "").toLowerCase();
  if (!isValidCode(code)) { res.statusCode = 404; return res.end("Not found"); }
  let found;
  try { found = await loadPlan(code); } catch (err) { console.error(err); res.statusCode = 503; return res.end("Temporarily unavailable"); }
  if (!found) { res.statusCode = 404; return res.end("Plan not found"); }
  const { plan } = found;
  const events = [];
  for (const date of Object.keys(plan.choices).sort()) {
    for (const sess of ["morning", "matinee", "evening", "late"]) {
      const c = plan.choices[date][sess];
      if (!c || !c.time) continue;
      const g = guideEntryFor(CITY_SLUG[plan.city] || "london", c.name);
      const part = partOf(g, sess, date);
      events.push({ date, time: c.time, name: c.name, part, venue: c.venue, address: c.address, url: c.ticketUrl || c.infoUrl || "", minutes: runtimeMinutes(g && g.runtime, part) });
    }
  }
  const ics = buildIcs({ city: plan.city, name: `${cityShort(plan.city)} shows · ${rangeLabel(plan.ranges)}`, events });
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="musical-trip-${code}.ics"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(ics);
}
