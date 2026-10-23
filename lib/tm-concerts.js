// Concerts for the planner (London first), from the licensed Ticketmaster Discovery API.
//
// The planner's London schedule sources (London Box Office day pages, londontheatre.co.uk's musicals
// list) carry no concerts, so the "Spectaculars & concerts" box had nothing to add. Ticketmaster does.
// Scope (Yuval, 23 Oct 2026): every Ticketmaster "Music" event at a central-London theatre or concert
// hall — not pubs, clubs or arenas.
//
// Running vs one-time: Ticketmaster is asked for the trip dates plus four more weeks. A concert seen on
// RUNNING_MIN_DATES or more distinct dates in that window is a run (a residency, a limited season) and
// becomes a normal, choosable planner card. Anything else is a one-night event: the planner lists it
// under "Also on this day" for information only.
//
// The result is returned beside the musicals schedule (data.concerts), never mixed into it, so the
// matinee pages and the weekly guide check — which read data.schedule — are unaffected.
import { affiliateUrl, guideEntryFor } from "./site-pages.js";

const TM = "https://app.ticketmaster.com/discovery/v2/events.json";
const CENTRE = "51.5103,-0.1301";       // Leicester Square
const RADIUS_KM = 8;                     // Royal Albert Hall, Barbican, Southbank, Hammersmith Apollo
const LOOKAHEAD_DAYS = 28;
const RUNNING_MIN_DATES = 3;
const MAX_PAGES = 4;                     // 4 x 200 events
const TTL_MS = 60 * 60 * 1000;

// A theatre or concert hall, judged from the venue name Ticketmaster gives.
const VENUE_OK = /theatre|theater|\bhall\b|palladium|coliseum|barbican|opera house|playhouse|\bapollo\b|southbank|wigmore|cadogan|\bempire\b|st\.? martin/i;
const VENUE_NO = /\b(pub|bar|club|caf[eé]|tavern|lounge|academy|arena|stadium|garden|rooftop|brewery|inn)\b|\bo2\b|scala|jazz/i;

const cache = new Map();

const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const nameKey = s => String(s || "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

export function centralVenue(name) {
  const n = String(name || "");
  return VENUE_OK.test(n) && !VENUE_NO.test(n);
}

function priceFrom(e) {
  const p = (e.priceRanges || []).map(r => Number(r.min)).filter(x => Number.isFinite(x) && x > 0);
  if (!p.length) return "";
  const min = Math.min(...p);
  const cur = (e.priceRanges.find(r => Number(r.min) === min) || {}).currency || "GBP";
  const sym = cur === "GBP" ? "£" : cur === "USD" ? "$" : "";
  if (!sym) return "";
  return sym + (Number.isInteger(min) ? String(min) : min.toFixed(2));
}

// Pure part, unit-tested: Ticketmaster events -> { shows, schedule } for the dates start..end.
export function buildConcerts(events, { city = "london", start, end }) {
  const groups = new Map();   // name key -> { name, venue, dates:Set, perfs:[] }
  for (const e of events || []) {
    const date = e.dates?.start?.localDate;
    const time = (e.dates?.start?.localTime || "").slice(0, 5);
    const status = e.dates?.status?.code || "";
    if (!date || !/^\d{2}:\d{2}$/.test(time) || /cancel|postpone/i.test(status)) continue;
    const venue = e._embedded?.venues?.[0]?.name || "";
    if (!centralVenue(venue)) continue;
    const name = String(e.name || "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    // Shows the guide already knows (ABBA Voyage, Come Alive!…) come from the theatre listings.
    if (guideEntryFor(city, name)) continue;
    const k = nameKey(name);
    const g = groups.get(k) || { name, venue, dates: new Set(), perfs: [] };
    g.dates.add(date);
    g.perfs.push({ date, time, url: e.url || "", from: priceFrom(e) });
    groups.set(k, g);
  }
  const shows = [];
  const schedule = {};
  for (const g of groups.values()) {
    const inTrip = g.perfs.filter(p => p.date >= start && p.date <= end);
    if (!inTrip.length) continue;
    const oneOff = g.dates.size < RUNNING_MIN_DATES;
    const first = inTrip.find(p => p.url)?.url || "";
    shows.push({ name: g.name, venue: g.venue, ticketUrl: first ? affiliateUrl(first, "planner-concert") : "", kind: "concert", oneOff });
    const seen = new Set();
    for (const p of inTrip) {
      const k = p.date + "|" + p.time;
      if (seen.has(k)) continue;
      seen.add(k);
      const meta = {};
      if (p.from) meta.from = p.from;
      if (p.url) meta.url = affiliateUrl(p.url, "planner-concert");
      (schedule[p.date] ||= []).push(Object.keys(meta).length ? [g.name, p.time, meta] : [g.name, p.time]);
    }
  }
  for (const d of Object.keys(schedule)) schedule[d].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  shows.sort((a, b) => a.name.localeCompare(b.name));
  return { shows, schedule, source: "Ticketmaster (concerts)" };
}

// Never throws: on any problem the planner simply has no concerts for that search.
export async function londonConcerts(start, end, { fetchImpl = fetch } = {}) {
  const apikey = process.env.TICKETMASTER_API_KEY;
  if (!apikey) return { shows: [], schedule: {}, error: "no-key" };
  const key = `${start}|${end}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const last = addDays(end, LOOKAHEAD_DAYS);
  const events = [];
  let value;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const u = new URL(TM);
      const params = {
        apikey, countryCode: "GB", segmentName: "Music", latlong: CENTRE, radius: RADIUS_KM, unit: "km",
        // A day either side in UTC; localDate is what we filter on.
        startDateTime: addDays(start, -1) + "T00:00:00Z", endDateTime: addDays(last, 1) + "T23:59:59Z",
        size: 200, page, sort: "date,asc", locale: "*"
      };
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      const r = await fetchImpl(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Ticketmaster ${r.status}`);
      const j = await r.json();
      events.push(...(j._embedded?.events || []));
      const pages = j.page?.totalPages ?? 1;
      if (page + 1 >= pages) break;
    }
    value = buildConcerts(events.filter(e => (e.dates?.start?.localDate || "") <= last), { city: "london", start, end });
    cache.set(key, { at: Date.now(), value });
  } catch (err) {
    console.error("concerts failed:", err?.message || err);
    value = { shows: [], schedule: {}, error: "unavailable" };
  }
  return value;
}
