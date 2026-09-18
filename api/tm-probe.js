// Diagnostic only (branch tm-probe): how much of our London / Broadway schedule does the Ticketmaster Discovery API cover?
//   /api/tm-probe?city=london&start=2026-11-09&end=2026-11-15
// Returns TM events grouped by title with performance counts, and a comparison against our own /api/schedule for the same week.

const TM = "https://app.ticketmaster.com/discovery/v2/events.json";
const CITY = {
  london: { city: "London", countryCode: "GB" },
  broadway: { city: "New York", countryCode: "US" }
};

async function tmEvents(params) {
  const out = [];
  for (let page = 0; page < 5; page++) {
    const u = new URL(TM);
    for (const [k, v] of Object.entries({ ...params, size: 200, page, sort: "date,asc", apikey: process.env.TICKETMASTER_API_KEY })) u.searchParams.set(k, v);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Ticketmaster ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const ev = j._embedded?.events || [];
    out.push(...ev);
    if (!j.page || page + 1 >= j.page.totalPages) break;
  }
  return out;
}

const norm = s => String(s || "").toLowerCase().replace(/\s*[-:–|(].*$/, "").replace(/\bthe musical\b|\bmusical\b/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!process.env.TICKETMASTER_API_KEY) return res.status(500).json({ error: "TICKETMASTER_API_KEY missing" });
    const city = CITY[req.query.city] ? req.query.city : "london";
    const start = req.query.start || "2026-11-09", end = req.query.end || "2026-11-15";
    const events = await tmEvents({ ...CITY[city], classificationName: "theatre", startDateTime: `${start}T00:00:00Z`, endDateTime: `${end}T23:59:59Z` });
    const byTitle = {};
    for (const e of events) {
      const c = e.classifications?.[0] || {};
      const key = e.name;
      const t = byTitle[key] ||= { name: e.name, venue: e._embedded?.venues?.[0]?.name || "", genre: c.genre?.name || "", subGenre: c.subGenre?.name || "", performances: 0, sampleUrl: e.url, dates: new Set() };
      t.performances++;
      if (e.dates?.start?.localDate) t.dates.add(`${e.dates.start.localDate} ${e.dates.start.localTime || ""}`.trim());
    }
    const tm = Object.values(byTitle).map(t => ({ ...t, dates: [...t.dates].sort().slice(0, 4) })).sort((a, b) => b.performances - a.performances);

    let ours = null, compare = null;
    try {
      const r = await fetch(`https://musicaltripplanner.com/api/schedule?city=${city}&start=${start}&end=${end}`);
      const j = await r.json();
      ours = (j.shows || []).map(s => s.name);
      const tmKeys = new Set(tm.map(t => norm(t.name)));
      const covered = ours.filter(n => tmKeys.has(norm(n)));
      compare = { ourShows: ours.length, coveredByTm: covered.length, covered, missing: ours.filter(n => !tmKeys.has(norm(n))) };
    } catch (e) { compare = { error: String(e.message || e) }; }

    res.status(200).json({ city, start, end, tmEventsFetched: events.length, tmTitles: tm.length, musicals: tm.filter(t => /musical/i.test(t.subGenre)).length, compare, tm });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
