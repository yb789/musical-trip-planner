// GET /api/tm-link?city=london|broadway&name=<show>&date=YYYY-MM-DD&time=HH:MM
// Returns { url } — the Ticketmaster page for that exact performance, wrapped in the Impact affiliate
// link — or { url: "" } when Ticketmaster doesn't sell it (the planner then shows no Ticketmaster button).
// Uses the licensed Discovery API through lib/site-pages.js (same lookup as the show pages).
import { entryForName, showPerformances, goPath } from "../lib/site-pages.js";

const CITY = { london: "london", broadway: "new-york" };
const mins = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : -1; };
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function pickPerformance(performances, date, time) {
  const day = performances.filter(p => p.date === date && p.url && !/cancel/i.test(p.status));
  const want = mins(time);
  const exact = day.find(p => p.time === time) || day.find(p => want >= 0 && Math.abs(mins(p.time) - want) <= 15);
  if (exact) return exact;
  // Same session only (matinee before 17:00, evening after), and only when it is unambiguous.
  const evening = want >= 1020;
  const same = day.filter(p => mins(p.time) >= 0 && (mins(p.time) >= 1020) === evening);
  return same.length === 1 && want < 0 ? same[0] : null;
}

export default async function handler(req, res) {
  const send = (status, body, cache) => {
    res.status(status);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", cache || "no-store");
    res.end(JSON.stringify(body));
  };
  if (req.method !== "GET") return send(405, { error: "GET only" });
  const q = req.query || {};
  const citySlug = CITY[String(q.city || "")];
  const name = String(q.name || "").slice(0, 120);
  const date = String(q.date || "");
  const time = String(q.time || "").slice(0, 5);
  if (!citySlug || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(400, { error: "city, name and date are required" });
  const show = entryForName(citySlug, name);
  if (!show) return send(200, { url: "" }, "public, s-maxage=86400, stale-while-revalidate=86400");
  // UTC window around the local date (a New York 8pm show starts after midnight UTC).
  const r = await showPerformances(citySlug, show, { start: addDays(date, -1), days: 3 });
  if (!r.ok) return send(200, { url: "" }, "public, s-maxage=300");
  const p = pickPerformance(r.performances, date, time);
  let url = "";
  if (p) {
    const tracked = goPath(p.url, `planner-${show.id}`); // /go?u=…&subId1=planner-<id> (lib/go.js adds Impact)
    if (tracked !== p.url) url = tracked; // only Ticketmaster pages get a button
  }
  return send(200, { url }, "public, s-maxage=3600, stale-while-revalidate=86400");
}
