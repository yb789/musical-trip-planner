// Weekly "guide check": compares the show guide (data/shows-*.json) with what the sources
// list, so new and closing shows are found without anyone looking by hand.
// Sources (names are compared internally; nothing here is published on the site):
//   1. the planner's own live schedule, two 4-day samples (1 and 5 weeks ahead)
//   2. SeatPlan's musicals listing (lists announced shows months before tickets go on sale)
//   3. Ticketmaster Discovery API, one week per month for the next 12 months
// The report is emailed to info@ by api/guide-check.js (Vercel cron, Mondays).
import fs from "node:fs";
import path from "node:path";
import scheduleHandler from "../api/schedule.js";
import { loadSeatPlanMusicals } from "./seatplan.js";
import { guide, entryForName, key } from "./site-pages.js";

const CITY = {
  london: { schedule: "london", seatplan: "london", tm: { city: "London", countryCode: "GB" }, label: "London" },
  "new-york": { schedule: "broadway", seatplan: "broadway", tm: { city: "New York", countryCode: "US" }, label: "New York" }
};

const iso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ignoreKeys(citySlug) {
  try {
    const file = path.join(process.cwd(), "data", "guide-ignore.json");
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Set((j[CITY[citySlug].schedule] || []).map(key).filter(Boolean));
  } catch { return new Set(); }
}

// Calls the planner's own schedule handler in-process.
async function scheduleSample(citySlug, start, end) {
  let body = null, status = 0;
  const res = {
    status(s) { status = s; return res; },
    setHeader() { return res; },
    end(text) { body = text; return res; }
  };
  await scheduleHandler({ method: "GET", query: { city: CITY[citySlug].schedule, start: iso(start), end: iso(end) } }, res);
  const j = body ? JSON.parse(body) : {};
  if (status !== 200) throw new Error(j.error || `schedule ${status}`);
  const firstDate = {};
  for (const [date, list] of Object.entries(j.schedule || {})) {
    for (const [name] of list) if (!firstDate[name] || date < firstDate[name]) firstDate[name] = date;
  }
  return (j.shows || []).map(s => ({ name: s.name, venue: s.venue || "", date: firstDate[s.name] || "" }));
}

async function ticketmasterSample(citySlug, today, fetchImpl) {
  const apikey = process.env.TICKETMASTER_API_KEY;
  if (!apikey) throw new Error("TICKETMASTER_API_KEY not set");
  const out = [];
  for (let m = 0; m < 12; m++) {
    const start = addDays(today, 30 * m + 1), end = addDays(start, 7);
    const u = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    const params = { ...CITY[citySlug].tm, classificationName: "theatre", startDateTime: iso(start) + "T00:00:00Z", endDateTime: iso(end) + "T00:00:00Z", size: 200, sort: "date,asc", apikey };
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Ticketmaster ${r.status}`);
    const j = await r.json();
    for (const e of j._embedded?.events || []) {
      const cls = (e.classifications || [])[0] || {};
      const genre = `${cls.genre?.name || ""} ${cls.subGenre?.name || ""}`;
      if (!/musical/i.test(genre)) continue;
      out.push({ name: e.name, venue: e._embedded?.venues?.[0]?.name || "", date: e.dates?.start?.localDate || "" });
    }
    await sleep(600); // Ticketmaster allows 2 requests per second
  }
  return out;
}

async function settle(label, fn) {
  try { return { label, ok: true, items: await fn() }; }
  catch (err) { return { label, ok: false, items: [], error: String(err?.message || err) }; }
}

export async function checkCity(citySlug, { today = new Date(), fetchImpl = fetch, sources: given } = {}) {
  const c = CITY[citySlug];
  const t = iso(today);
  // `given` lets tests supply source results directly.
  const sources = given ? given[citySlug] : await Promise.all([
    settle("Planner live schedule", async () => {
      const a = await scheduleSample(citySlug, addDays(today, 7), addDays(today, 10));
      const b = await scheduleSample(citySlug, addDays(today, 35), addDays(today, 38));
      return [...a, ...b];
    }),
    settle("SeatPlan listing", async () => (await loadSeatPlanMusicals(c.seatplan)).map(s => ({ name: s.name, venue: "", date: "" }))),
    settle("Ticketmaster", () => ticketmasterSample(citySlug, today, fetchImpl))
  ]);

  const ignore = ignoreKeys(citySlug);
  const shows = guide(citySlug);
  const seen = new Map();      // guide id -> Set of source labels
  const missing = new Map();   // normalised name -> { name, sources:Set, venue, date }
  for (const src of sources) {
    for (const it of src.items) {
      const g = entryForName(citySlug, it.name);
      if (g) {
        if (!seen.has(g.id)) seen.set(g.id, new Set());
        seen.get(g.id).add(src.label);
        continue;
      }
      const k = key(String(it.name).replace(/\s*[-–|(:].*$/, "")) || key(it.name);
      if (!k || ignore.has(k) || ignore.has(key(it.name))) continue;
      if (!missing.has(k)) missing.set(k, { name: it.name, sources: new Set(), venue: "", date: "" });
      const m = missing.get(k);
      m.sources.add(src.label);
      if (!m.venue && it.venue) m.venue = it.venue;
      if (it.date && (!m.date || it.date < m.date)) m.date = it.date;
      if (it.name.length < m.name.length) m.name = it.name;
    }
  }

  const in30 = iso(addDays(today, 30));
  const scheduleOk = sources[0].ok;
  const scheduleSeen = id => seen.get(id)?.has("Planner live schedule");
  const report = {
    city: c.label,
    newShows: [...missing.values()].sort((a, b) => a.name.localeCompare(b.name)).map(m => ({ ...m, sources: [...m.sources] })),
    nowPlaying: shows.filter(g => g.status === "upcoming" && scheduleSeen(g.id)).map(g => g.title),
    closingSoon: shows.filter(g => g.bookingUntil && g.bookingUntil >= t && g.bookingUntil <= in30)
      .map(g => ({ title: g.title, until: g.bookingUntil, limitedRun: !!g.limitedRun })),
    pastBooking: shows.filter(g => g.bookingUntil && g.bookingUntil < t)
      .map(g => ({ title: g.title, until: g.bookingUntil, limitedRun: !!g.limitedRun })),
    notFound: scheduleOk
      ? shows.filter(g => g.status !== "upcoming" && !(g.bookingUntil && g.bookingUntil < t) && !seen.has(g.id)).map(g => g.title)
      : [],
    sources: sources.map(s => ({ label: s.label, ok: s.ok, count: s.items.length, error: s.error || "" }))
  };
  return report;
}

export async function runGuideCheck(opts = {}) {
  const today = opts.today || new Date();
  const cities = await Promise.all(Object.keys(CITY).map(c => checkCity(c, { ...opts, today })));
  return { date: iso(today), cities };
}

// ---------- email ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const fmt = isoDate => {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};

export function summaryLine(r) {
  return r.cities.map(c => `${c.city}: ${c.newShows.length} new, ${c.closingSoon.length} closing, ${c.pastBooking.length + c.notFound.length} to check`).join(" · ");
}

export function reportHtml(r) {
  const section = (title, items, render, help) => items.length
    ? `<h3 style="margin:16px 0 4px">${esc(title)} (${items.length})</h3>${help ? `<p style="margin:0 0 6px;color:#666">${esc(help)}</p>` : ""}<ul style="margin:0;padding-left:20px">${items.map(i => `<li>${render(i)}</li>`).join("")}</ul>`
    : "";
  const city = c => `
<h2 style="margin:24px 0 4px;border-bottom:2px solid #d6a860">${esc(c.city)}</h2>
${section("New: not in the guide", c.newShows, m => `<b>${esc(m.name)}</b>${m.venue ? ` · ${esc(m.venue)}` : ""}${m.date ? ` · first date seen ${esc(fmt(m.date))}` : ""} <span style="color:#666">(${esc(m.sources.join(", "))})</span>`, "Reply or forward to Claude to draft a description; or add the name to data/guide-ignore.json to stop reporting it.")}
${section("Coming soon → now playing", c.nowPlaying, t => esc(t), "These are marked upcoming in the guide but now have performances: switch them to running.")}
${section("Closing within 30 days", c.closingSoon, s => `${esc(s.title)} · ${s.limitedRun ? "closes" : "booking until"} ${esc(fmt(s.until))}`, "Open-ended shows often extend their booking period; check and update the date.")}
${section("Booking date passed", c.pastBooking, s => `${esc(s.title)} · ${esc(fmt(s.until))}${s.limitedRun ? " (limited run: probably closed)" : " (probably extended: update the date)"}`, "These are already hidden from the helper and the city page.")}
${section("Not found in any source", c.notFound, t => esc(t), "Possibly closed, or just missing from the sampled dates. Check before removing.")}
${!c.newShows.length && !c.nowPlaying.length && !c.closingSoon.length && !c.pastBooking.length && !c.notFound.length ? `<p>Nothing to do. The guide matches every source.</p>` : ""}
<p style="color:#888;font-size:12px;margin-top:10px">Sources: ${c.sources.map(s => `${esc(s.label)} ${s.ok ? `✓ ${s.count}` : `✗ ${esc(s.error)}`}`).join(" · ")}</p>`;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#181818;max-width:720px">
<h1 style="font-size:20px;margin:0 0 4px">Musical Trip Planner · weekly guide check</h1>
<p style="margin:0;color:#666">${esc(fmt(r.date))} · ${esc(summaryLine(r))}</p>
${r.cities.map(city).join("")}
</div>`;
}

export function reportText(r) {
  const lines = [`Musical Trip Planner · weekly guide check · ${fmt(r.date)}`, summaryLine(r), ""];
  for (const c of r.cities) {
    lines.push(`== ${c.city} ==`);
    for (const m of c.newShows) lines.push(`NEW: ${m.name}${m.venue ? " · " + m.venue : ""}${m.date ? " · first " + fmt(m.date) : ""} (${m.sources.join(", ")})`);
    for (const t of c.nowPlaying) lines.push(`NOW PLAYING (was upcoming): ${t}`);
    for (const s of c.closingSoon) lines.push(`CLOSING: ${s.title} · ${fmt(s.until)}`);
    for (const s of c.pastBooking) lines.push(`DATE PASSED: ${s.title} · ${fmt(s.until)}`);
    for (const t of c.notFound) lines.push(`NOT FOUND: ${t}`);
    lines.push(`Sources: ${c.sources.map(s => `${s.label} ${s.ok ? s.count : "failed: " + s.error}`).join(" · ")}`, "");
  }
  return lines.join("\n");
}

export async function emailReport(r, fetchImpl = fetch) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const resp = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FEEDBACK_FROM || "Musical Trip Planner <feedback@musicaltripplanner.com>",
      to: [process.env.FEEDBACK_TO || "info@musicaltripplanner.com"],
      subject: `Guide check ${fmt(r.date)}: ${summaryLine(r)}`,
      html: reportHtml(r),
      text: reportText(r)
    }),
    signal: AbortSignal.timeout(10000)
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}`);
  return true;
}
