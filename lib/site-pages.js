// Server-rendered, indexable pages: one page per musical, a hub per city and the guide articles.
// Show descriptions come from data/shows-*.json. Performance times come from the licensed
// Ticketmaster Discovery API (env TICKETMASTER_API_KEY); shows Ticketmaster doesn't sell get the
// page without a timetable and a link to live times in the planner.
import fs from "node:fs";
import path from "node:path";
import { GUIDES } from "./guides-content.js";
import { loadSeatPlanShows, matchSeatPlanShow } from "./seatplan.js";

export const SITE = "https://musicaltripplanner.com";

export const CITIES = {
  london: { data: "london", label: "London · West End", short: "London", area: "in the West End", tm: { city: "London", countryCode: "GB" }, hub: "West End musicals" },
  "new-york": { data: "broadway", label: "New York · Broadway", short: "New York", area: "on Broadway", tm: { city: "New York", countryCode: "US" }, hub: "Broadway musicals" }
};
const DATA_TO_SLUG = { london: "london", broadway: "new-york" };

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- show guide data ----------
const guideCache = {};
export function guide(citySlug) {
  const c = CITIES[citySlug];
  if (!c) return [];
  if (!guideCache[citySlug]) {
    const file = path.join(process.cwd(), "data", `shows-${c.data}.json`);
    const shows = JSON.parse(fs.readFileSync(file, "utf8")).shows || [];
    for (const g of shows) g._keys = [...new Set([g.title, ...(g.match || [])].map(key).filter(Boolean))];
    guideCache[citySlug] = shows;
  }
  return guideCache[citySlug];
}
export function key(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/&/g, "and")
    .replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, "").replace(/(anewmusical|themusical|musical)$/, "");
}
// Ticketmaster names look like "Hamilton (NY)", "Wicked - New York", "MJ - The Musical", "SIX: The Musical".
function nameKeys(name) {
  const full = key(name);
  const head = key(String(name || "").replace(/\s*[-–|(:].*$/, ""));
  return [...new Set([full, head].filter(Boolean))];
}
export function entryForName(citySlug, name) {
  const ks = nameKeys(name);
  return guide(citySlug).find(g => ks.some(k => g._keys.includes(k))) || null;
}
export const findShow = (citySlug, id) => guide(citySlug).find(g => g.id === id) || null;
// Show kinds: musicals are the default; plays, spectaculars and family shows are opt-in extras.
export const KINDS = {
  musical: { label: "Musical", plural: "Musicals" },
  play: { label: "Play", plural: "Plays" },
  spectacular: { label: "Spectacular", plural: "Spectaculars & concerts" },
  family: { label: "Family show", plural: "Family shows" }
};
export const kindOf = g => (g && KINDS[g.kind] ? g.kind : "musical");
// For the live-schedule scrapers: the guide entry a listing name belongs to, with its kind.
// Listing names are decorated ("Disney's The Lion King", "Hamilton on Broadway"), so both the
// raw and the cleaned name are tried. Returns null for names the guide doesn't know.
export function guideEntryFor(citySlug, name) {
  const g = entryForName(citySlug, name) || entryForName(citySlug, cleanListingName(name));
  return g ? { id: g.id, title: g.title, kind: kindOf(g), offBroadway: !!g.offBroadway, runtime: g.runtime || "", ...(g.parts === 2 ? { parts: 2, partsNote: g.partsNote || "" } : {}) } : null;
}
// Same rule as the helper (show-helper.js): once the listed booking/closing date has passed the show
// is no longer offered. Its page stays up with a note. The weekly guide check flags these for review.
const todayIso = () => new Date().toISOString().slice(0, 10);
export const isPastBooking = g => !!(g.bookingUntil && g.bookingUntil < todayIso());

// ---------- Ticketmaster ----------
const TM = "https://app.ticketmaster.com/discovery/v2/events.json";
const tmCache = new Map();
function tmKeyword(title) {
  return String(title).replace(/^&\s*/, "").replace(/\s*(:|-)?\s*the musical$/i, "").replace(/\s*\(.*\)\s*$/, "").trim();
}
function ymd(d) { return d.toISOString().slice(0, 19) + "Z"; }

// `start` (YYYY-MM-DD, optional) moves the window forward; the planner uses it for a single trip day.
export async function showPerformances(citySlug, show, { days = 35, start = "", fetchImpl = fetch, check = false } = {}) {
  const apikey = process.env.TICKETMASTER_API_KEY;
  if (!apikey) return { ok: false, reason: "no-key", performances: [], diag: { key: false } };
  const cacheKey = `${citySlug}:${show.id}:${start}:${days}`;
  const hit = tmCache.get(cacheKey);
  if (!check && hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;
  const now = start ? new Date(start + "T00:00:00Z") : new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const u = new URL(TM);
  const params = { ...CITIES[citySlug].tm, keyword: tmKeyword(show.title), classificationName: "theatre", startDateTime: ymd(now), endDateTime: ymd(end), size: 200, sort: "date,asc", apikey };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  let value;
  // Diagnostics for ?check=1 (never includes the API key).
  const diag = { key: true, keyword: params.keyword, city: params.city, httpStatus: null, returned: 0, matched: 0, sampleNames: [], error: "" };
  try {
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(8000) });
    diag.httpStatus = r.status;
    if (!r.ok) throw new Error(`Ticketmaster ${r.status}`);
    const j = await r.json();
    const all = j._embedded?.events || [];
    diag.returned = all.length;
    diag.sampleNames = [...new Set(all.map(e => e.name))].slice(0, 8);
    const events = all.filter(e => {
      const g = entryForName(citySlug, e.name);
      return g && g.id === show.id && e.dates?.start?.localDate;
    });
    const performances = events.map(e => {
      const v = e._embedded?.venues?.[0] || {};
      return {
        date: e.dates.start.localDate,
        time: (e.dates.start.localTime || "").slice(0, 5),
        dateTime: e.dates.start.dateTime || "",
        status: e.dates.status?.code || "",
        url: e.url || "",
        venue: v.name || "",
        address: [v.address?.line1, v.city?.name, v.postalCode].filter(Boolean).join(", ")
      };
    }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    diag.matched = performances.length;
    value = { ok: true, performances, diag };
  } catch (err) {
    console.error("ticketmaster failed", show.id, err?.message || err);
    diag.error = String(err?.message || err);
    value = { ok: false, reason: "error", performances: [], diag };
  }
  if (value.ok) tmCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// ---------- layout ----------
const CSS = `
:root{--bg:#f5f1e8;--paper:#fffdf8;--ink:#181818;--muted:#6b665f;--line:#ddd6ca;--accent:#7c2d12;--green:#1f4b3f;--gold:#d6a860}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}
a{color:var(--accent)}
header{background:linear-gradient(135deg,#17130f,#35251c);color:#fffdf8;padding:22px 16px 28px}
header .wrap,main,nav.crumbs{max-width:860px;margin:0 auto}
header .brand{font:700 15px/1 Georgia,serif;color:var(--gold);letter-spacing:.04em;text-decoration:none}
.topbar{display:flex;justify-content:space-between;align-items:center;gap:10px 14px;flex-wrap:wrap}
.topnav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.topnav a{display:inline-flex;align-items:center;min-height:40px;padding:8px 14px;border-radius:10px;border:1px solid rgba(255,253,248,.35);color:#fffdf8;text-decoration:none;font-size:14px;font-weight:600}
.topnav a:hover{background:rgba(255,253,248,.1)}
.topnav a.go{background:var(--gold);border-color:var(--gold);color:#17130f;font-weight:700}
.sections{display:flex;gap:6px 16px;flex-wrap:wrap;margin-top:14px;font-size:14px}
.sections a{color:#eadfd5;text-decoration:none;border-bottom:2px solid transparent;padding-bottom:2px}
.sections a:hover,.sections a[aria-current="page"]{color:#fff;border-bottom-color:var(--gold)}
header h1{font:700 clamp(26px,5vw,40px)/1.15 Georgia,serif;margin:14px 0 8px}
header p{margin:0;color:#eadfd5;font-size:16px}
nav.crumbs{padding:12px 16px 0;font-size:13px;color:var(--muted)}
nav.crumbs a{color:var(--muted)}
main{padding:14px 16px 60px}
h2{font:700 24px/1.25 Georgia,serif;margin:30px 0 10px}
h3{font-size:17px;margin:18px 0 6px}
.card{background:var(--paper);border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 12px 35px rgba(30,25,20,.06);margin:0 0 12px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:12px;border:1px solid var(--line);background:#fffaf2;color:var(--ink);font-weight:600;text-decoration:none;font-size:15px}
.btn.primary{background:var(--green);border-color:var(--green);color:#fff}
.btn.sp{background:var(--accent);border-color:var(--accent);color:#fff}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.pill{font-size:12px;padding:4px 9px;border-radius:999px;background:#eee8df;color:#4a453e}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:13px;color:var(--muted);font-weight:600}
td.t a{font-weight:600}
.nw,td.t a{white-space:nowrap}
td.t .end{white-space:nowrap;display:block;font-size:12px;color:var(--muted);margin:1px 0 6px}
.muted{color:var(--muted)}
.note{color:var(--muted);font-size:13px;margin:26px 0 0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.grid .card{margin:0}
.grid h3{margin:0 0 4px;font:700 19px/1.25 Georgia,serif}
.grid h3 a{text-decoration:none;color:var(--ink)}
.grid p{margin:6px 0 0;font-size:14px}
.faq h3{margin-top:14px}
.daystrip{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin:16px 0}
.daystrip a{display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 4px;border-radius:12px;border:1px solid var(--line);background:var(--paper);text-decoration:none;color:var(--ink)}
.daystrip a b{font-size:13px;color:var(--muted);font-weight:600}.daystrip a span{font:700 22px/1 Georgia,serif;color:var(--green)}
.daystrip a.none span{color:var(--muted);font-weight:400}
footer{text-align:center;color:var(--muted);font-size:13px;padding:0 16px 30px}
footer a{color:var(--muted)}
@media(max-width:640px){.grid{grid-template-columns:1fr}th.venue,td.venue{display:none}}
`;

const SECTIONS = [{ name: "West End musicals", href: "/london/" }, { name: "Broadway musicals", href: "/new-york/" }, { name: "Trip guides", href: "/guides/" }, { name: "About", href: "/about/" }];

function layout({ title, description, canonical, h1, lead, crumbs = [], body, jsonld = [], h1NoTranslate = false }) {
  const url = SITE + canonical;
  const crumbHtml = crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="/#/start">Home</a> › ${crumbs.map(c => c.href ? `<a href="${esc(c.href)}">${esc(c.name)}</a>` : esc(c.name)).join(" › ")}</nav>` : "";
  const ld = jsonld.map(o => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\" + "u003c")}</script>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}"><meta name="theme-color" content="#17130f">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/api/og?icon=180">
<meta property="og:type" content="website"><meta property="og:site_name" content="Musical Trip Planner">
<meta property="og:url" content="${esc(url)}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/api/og"><meta name="twitter:card" content="summary_large_image">
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>
<script defer src="/events.js"></script>
${ld}
<style>${CSS}</style></head>
<body>
<header><div class="wrap">
<div class="topbar"><a class="brand" href="/#/start">MUSICAL TRIP PLANNER</a><nav class="topnav" aria-label="Planner"><a href="/#/start">← Start screen</a><a class="go" href="/#/plan">Open the planner</a></nav></div>
<nav class="sections" aria-label="Sections">${SECTIONS.map(x => `<a href="${x.href}"${canonical.startsWith(x.href) ? ' aria-current="page"' : ""}>${x.name}</a>`).join("")}</nav>
<h1${h1NoTranslate ? ' translate="no"' : ""}>${esc(h1)}</h1>${lead ? `<p${h1NoTranslate ? ' translate="no"' : ""}>${esc(lead)}</p>` : ""}</div></header>
${crumbHtml}
<main>${body}</main>
<footer><a href="/london/">West End musicals</a> · <a href="/new-york/">Broadway musicals</a> · <a href="/guides/">Guides</a> · <a href="/about/">About &amp; contact</a> · <a href="/#/plan">Open the planner</a></footer>
</body></html>`;
}

function breadcrumbLd(items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: SITE + it.href })) };
}

const VIBE = { spectacle: "Big spectacle", feelgood: "Feel-good", emotional: "Moving story", edgy: "Funny & irreverent" };
const AUD = { family: "Family-friendly", teens: "Teens and up", adults: "Adults" };
const DISCLAIMER = `Musical Trip Planner is a free planning tool, not a ticket seller. Performance times come from Ticketmaster's listings and can change; always check with the ticket seller before booking. Ticket links go to third-party sites, and some may be affiliate links that earn us a small commission at no extra cost to you. Show descriptions are our own short summaries.`;

const fmtDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// ---------- affiliate links ----------
// Impact.com tracking links (partner account 7761524): Ticketmaster UK/US (approved Oct 2026) and SeatPlan
// (approved Oct 2026, London + New York). The planner's buttons use the same bases (patch-affiliate-links.mjs).
// The ticket page is passed in ?u=; subId1 tells us in Impact's reports which page the click came from.
const TM_AFFILIATE = [
  { host: "ticketmaster.co.uk", base: "https://ticketmaster.evyy.net/c/7761524/1965662/24023" },
  { host: "ticketmaster.com", base: "https://ticketmaster.evyy.net/c/7761524/264167/4272" },
  { host: "seatplan.com", base: "https://seatplan.sjv.io/c/7761524/2219054/28679" }
];
export function affiliateUrl(url, subId = "") {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return url; }
  const p = TM_AFFILIATE.find(x => host === x.host || host.endsWith("." + x.host));
  if (!p) return url;
  return `${p.base}?u=${encodeURIComponent(url)}${subId ? `&subId1=${encodeURIComponent(subId)}` : ""}`;
}

// SeatPlan page for a guide show (only the link: no SeatPlan images or text are used). Tries the
// title and the guide's match names; null when SeatPlan doesn't list it. Never waits more than 4 s.
export async function seatPlanPage(citySlug, show, { timeoutMs = 4000 } = {}) {
  const city = CITIES[citySlug]?.data;
  if (!city || show.closed) return null;
  let list = [];
  try {
    list = await Promise.race([loadSeatPlanShows(city), new Promise(r => setTimeout(() => r([]), timeoutMs))]);
  } catch { list = []; }
  if (!list.length) return null;
  for (const name of [show.title, ...(show.match || [])]) {
    const m = matchSeatPlanShow(city, name, list);
    if (m) return m.href;
  }
  return null;
}

// ---------- running time & clock helpers ----------
// show.runtime looks like "2h 45m, 1 interval", "1h 20m, no intermission" or "1h 50m".
export function runtimeMinutes(rt) {
  const m = String(rt || "").match(/(\d+)\s*h(?:\s*(\d+)\s*m)?/);
  return m ? Number(m[1]) * 60 + Number(m[2] || 0) : 0;
}
function breakInfo(rt) {
  const m = String(rt || "").match(/\b(no|\d+)\s+(interval|intermission)s?\b/);
  return m ? { count: m[1] === "no" ? 0 : Number(m[1]), word: m[2] } : null;
}
function durationText(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return [h ? `${h} hour${h === 1 ? "" : "s"}` : "", m ? `${m} minutes` : ""].filter(Boolean).join(" ");
}
// "about 2 hours 45 minutes, including one interval"
function runtimeSentence(rt) {
  const mins = runtimeMinutes(rt);
  if (!mins) return "";
  const b = breakInfo(rt);
  const tail = !b ? "" : b.count === 0 ? ` with no ${b.word}` : `, including ${b.count === 1 ? "one" : b.count} ${b.word}${b.count === 1 ? "" : "s"}`;
  return `about ${durationText(mins)}${tail}`;
}
const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const addMin = (t, mins) => { const x = (toMin(t) + mins) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
// "14:30" -> "2:30 pm"
function clock(t) {
  if (!/^\d{2}:\d{2}$/.test(String(t))) return String(t || "TBC");
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
const isMatinee = t => !!t && t < "17:00";
const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const weekday = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const andList = a => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
// Start times grouped by session, most frequent first: [{ time: "14:30", days: ["Wednesday", "Saturday"], n: 8 }]
function typicalTimes(perfs, matinee) {
  const by = new Map();
  for (const p of perfs) {
    if (!/^\d{2}:\d{2}$/.test(p.time) || isMatinee(p.time) !== matinee || p.status === "cancelled") continue;
    const g = by.get(p.time) || { time: p.time, days: new Set(), n: 0 };
    g.days.add(weekday(p.date)); g.n++;
    by.set(p.time, g);
  }
  return [...by.values()].filter(g => g.n >= 2 || by.size === 1)
    .map(g => ({ ...g, days: WEEK.filter(d => g.days.has(d)) }))
    .sort((a, b) => b.n - a.n || a.time.localeCompare(b.time));
}
// ["Tuesday", ..., "Saturday"] -> "Tuesday to Saturday"; otherwise "Wednesday and Saturday"
function daysText(days) {
  const idx = days.map(d => WEEK.indexOf(d));
  const run = days.length >= 3 && idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  return run ? `${days[0]} to ${days[days.length - 1]}` : andList(days);
}
// "2:30 pm on Wednesday and Saturday, and 3:00 pm on Sunday"
function timesText(groups) {
  const parts = groups.map(g => `${clock(g.time)} on ${daysText(g.days)}`);
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

const plannerLink = (citySlug, show) =>`/?city=${CITIES[citySlug].data}${show ? "&show=" + encodeURIComponent(show.id) : ""}#/plan`;

// Visible only with ?check=1: what the Ticketmaster request returned for this page.
function checkHtml(tm) {
  const d = tm.diag || {};
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  return `<div class="card" style="margin-top:20px;border-color:#b45309"><b>Ticketmaster check</b><table>${[
    row("API key set on server", d.key ? "yes" : "NO"),
    row("Search keyword", d.keyword || ""), row("City", d.city || ""),
    row("HTTP status", d.httpStatus ?? "no request"),
    row("Events returned", d.returned ?? 0), row("Matched to this show", d.matched ?? 0),
    row("Names Ticketmaster returned", (d.sampleNames || []).join(" | ") || "none"),
    row("Error", d.error || "none")].join("")}</table></div>`;
}

// ---------- show page ----------
export async function renderShow(citySlug, id, opts = {}) {
  const c = CITIES[citySlug];
  const show = c && findShow(citySlug, id);
  if (!show) return null;
  const [tm, sp] = await Promise.all([showPerformances(citySlug, show, opts), seatPlanPage(citySlug, show)]);
  if (opts.meta) { opts.meta.tmOk = tm.ok; opts.meta.seatplan = !!sp; }
  const spBtn = sp ? `<a class="btn sp" href="${esc(affiliateUrl(sp, `show-${show.id}`))}" target="_blank" rel="noopener sponsored">Tickets on <span translate="no">SeatPlan</span> ↗</a>`
    : (show.tickets ? `<a class="btn sp" href="${esc(show.tickets)}" target="_blank" rel="noopener">Tickets ↗</a>` : "");
  const perfs = tm.performances;
  const venue = perfs[0]?.venue || show.venue;
  const address = perfs.find(p => p.address)?.address || "";
  const days = {};
  for (const p of perfs) (days[p.date] ||= []).push(p);
  const dayKeys = Object.keys(days).sort();
  const mins = runtimeMinutes(show.runtime);
  const rtText = runtimeSentence(show.runtime);
  const mats = typicalTimes(perfs, true), eves = typicalTimes(perfs, false);
  const ends = t => mins && /^\d{2}:\d{2}$/.test(t) ? clock(addMin(t, mins)) : "";

  const pills = [AUD[show.audience], ...(show.vibes || []).map(v => VIBE[v]), show.runtime].filter(Boolean);
  let times;
  if (dayKeys.length) {
    // Usual start times, which days they fall on and roughly when the show comes down.
    const byTime = gs => [...gs].sort((a, b) => a.time.localeCompare(b.time));
    const typRows = [...byTime(mats).map(g => ["Matinee", g]), ...byTime(eves).map(g => ["Evening", g])].map(([s, g]) =>
      `<tr><td>${s}</td><td class="t nw">${esc(clock(g.time))}</td>${mins ? `<td class="nw">${esc(ends(g.time))}</td>` : ""}<td>${esc(daysText(g.days))}</td></tr>`).join("");
    const typical = typRows ? `<div class="card"><h3 style="margin-top:0">Usual start and finish times</h3><table><thead><tr><th>Show</th><th>Starts</th>${mins ? "<th>Ends about</th>" : ""}<th>Days</th></tr></thead><tbody>${typRows}</tbody></table>
<p class="muted" style="margin:10px 0 0;font-size:14px">${mins ? `Running time ${esc(rtText)}. Finish times add the running time to the start time; allow a few extra minutes for applause and late starts.` : "The running time hasn't been published yet, so we can't estimate finish times."} Times can change, so check your exact date in the table below.</p></div>` : "";
    const rows = dayKeys.slice(0, 28).map(d => {
      const ps = days[d];
      const cell = sess => ps.filter(p => sess === "m" ? isMatinee(p.time) : !isMatinee(p.time))
        .map(p => {
          const t = esc(clock(p.time));
          const e = ends(p.time);
          return (p.url ? `<a href="${esc(affiliateUrl(p.url, `show-${show.id}`))}" target="_blank" rel="noopener sponsored">${t}</a>` : t) + (e ? `<span class="end">ends ~${esc(e)}</span>` : "");
        }).join(" ") || '<span class="muted">–</span>';
      return `<tr><td>${esc(fmtDate(d))}</td><td class="t">${cell("m")}</td><td class="t">${cell("e")}</td></tr>`;
    }).join("");
    const sessDays = m => WEEK.filter(d => perfs.some(p => p.time && isMatinee(p.time) === m && weekday(p.date) === d));
    const matDays = sessDays(true), eveDays = sessDays(false);
    times = `${typical}<p>${matDays.length ? `Matinees in the coming weeks fall on <b>${esc(daysText(matDays))}</b>. ` : "No matinees are listed in the coming weeks. "}${eveDays.length ? `Evening performances on <b>${esc(daysText(eveDays))}</b>.` : ""} Tap a time to see tickets.</p>
<div class="card"><table><thead><tr><th>Date</th><th>Matinee</th><th>Evening</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (tm.ok) {
    times = `<div class="card"><p>No performances of ${esc(show.title)} are listed by our ticket-data partner for the next few weeks. ${show.status === "upcoming" && show.dates ? esc(show.dates) + ". " : ""}Many theatres sell their own tickets, so the show may still be on. The planner checks live listings for your exact dates.</p><div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug, show))}">Check live times in the planner</a>${spBtn}</div></div>`;
  } else {
    times = `<div class="card"><p>Performance times are temporarily unavailable. The planner checks live listings for your exact dates.</p><div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug, show))}">Check live times in the planner</a></div></div>`;
  }

  // Shows that pair well: same city, sharing a vibe, playing the other session.
  const others = guide(citySlug).filter(g => g.id !== show.id && kindOf(g) === kindOf(show) && g.status !== "upcoming" && !isPastBooking(g) && (g.vibes || []).some(v => (show.vibes || []).includes(v))).slice(0, 6);
  const othersHtml = others.length ? `<h2>If you like <span translate="no">${esc(show.title)}</span></h2><div class="grid">${others.map(g => `<div class="card"><h3 translate="no"><a href="/${citySlug}/${esc(g.id)}/">${esc(g.title)}</a></h3><div class="muted" translate="no">${esc(g.venue)}</div><p>${esc(g.blurb)}</p></div>`).join("")}</div>` : "";

  // Quick answers to what people search for: "how long is X", "X matinee times", "what time does X finish".
  const faq = [];
  if (show.parts === 2) faq.push([`Is ${show.title} one show or two?`, show.partsNote || "It is a two-part play: Part One and Part Two are separate tickets, and you need both to see the whole story."]);
  if (show.parts === 2) faq.push([`How long is ${show.title}?`, `${show.runtime || "Each part runs about two and a half hours with an interval"}. The two parts together are a full day of theatre, so allow time to eat between them.`]);
  else if (rtText) faq.push([`How long is ${show.title}?`, `${show.title} runs ${rtText}.`]);
  if (mats.length) faq.push([`What time does ${/^the\s/i.test(show.title) ? show.title.replace(/^the/i, "the") : "the " + show.title} matinee start?`, `In the coming weeks, matinees of ${show.title} start at ${timesText(mats)}.`]);
  else if (dayKeys.length && eves.length) faq.push([`Does ${show.title} have matinees?`, `No matinees are listed in the coming weeks. Evening performances start at ${timesText(eves)}.`]);
  if (mins && (mats.length || eves.length)) {
    const parts = [mats[0] && `a ${clock(mats[0].time)} matinee ends around ${ends(mats[0].time)}`, eves[0] && `a ${clock(eves[0].time)} evening performance ends around ${ends(eves[0].time)}`].filter(Boolean);
    const a = parts.join(", and ");
    faq.push([`What time does ${show.title} finish?`, `${a[0].toUpperCase()}${a.slice(1)}. That's based on the running time of ${rtText}.`]);
  }
  if (mins && mats.length && eves.length) {
    const matEnd = addMin(mats[0].time, mins);
    if (matEnd <= "18:00") faq.push([`Can I see ${show.title} and another show on the same day?`, `Yes. A ${clock(mats[0].time)} matinee ends around ${clock(matEnd)}, which leaves time for dinner before an evening show elsewhere ${c.area}. The planner lists what else is playing that evening.`]);
  }
  const faqHtml = faq.length ? `<h2>Quick answers</h2><div class="card faq">${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</div>` : "";

  const mapQ = encodeURIComponent([String(venue).replace(/\s*·\s*Off-Broadway$/, ""), address || c.tm.city].filter(Boolean).join(", "));
  const body = `
<div class="card">
<div class="pills">${pills.map(p => `<span class="pill">${esc(p)}</span>`).join("")}</div>
<p style="font-size:17px;margin:6px 0">${esc(show.blurb)}</p>${show.parts === 2 ? `<p class="muted" style="background:#fff2d9;border:1px solid #e5c681;border-radius:10px;padding:8px 12px;color:#73520b"><b>Two-part play.</b> ${esc((show.partsNote || "").replace(/^Two-part play\.\s*/, ""))}</p>` : ""}
${show.offBroadway ? `<p class="muted"><b>Off-Broadway show.</b> The planner's live schedule covers Broadway only; use the times below or check with the theatre.</p>` : ""}
${show.closed ? `<p><b>This production has closed${show.bookingUntil ? ` (final performance ${esc(fmtDate(show.bookingUntil))})` : ""}.</b> The planner shows what else is playing ${esc(c.area)} on your dates.</p>` : isPastBooking(show) ? `<p><b>${show.limitedRun ? "This limited run has ended." : "The booking period we have on file has passed."}</b> ${show.limitedRun ? "" : "The show may still be running: "}check live times in the planner for your dates.</p>` : show.status === "upcoming" && show.dates ? `<p class="muted">Coming soon · ${esc(show.dates)}</p>` : show.limitedRun && show.dates ? `<p class="muted">Limited run · ${esc(show.dates)}</p>` : ""}
<div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug, show))}">Plan a trip around <span translate="no">${esc(show.title)}</span></a>${spBtn}${kindOf(show) === "musical" || show.listen ? `<a class="btn" href="https://open.spotify.com/search/${encodeURIComponent(show.listen || show.title)}" target="_blank" rel="noopener">${kindOf(show) === "musical" ? "Listen to the cast recording" : "Listen to the music"} ↗</a>` : ""}</div>
</div>
<h2>Matinee and evening times</h2>
${times}
${faqHtml}
<h2>Theatre</h2>
<div class="card"><b translate="no">${esc(venue)}</b>${address ? `<br><span class="muted" translate="no">${esc(address)}</span>` : ""}<br><a href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>
<h2>Seeing two shows in one day?</h2>
<p>With a matinee and an evening performance you can fit two shows into one day ${esc(c.area)}. The <a href="${esc(plannerLink(citySlug, show))}">trip planner</a> shows what else is playing on each date you're in town and warns you about clashes. Read <a href="/guides/two-shows-one-day/">how to see two shows in one day</a>, or see <a href="/${citySlug}/matinees/">which ${esc(AREA[citySlug])} musicals have matinees on each day</a>.</p>
${othersHtml}
<p class="note">${esc(DISCLAIMER)}</p>${opts.check ? checkHtml(tm) : ""}`;

  const title = `${show.title} ${mins ? "matinee times & running time" : "matinee & evening times"} – ${c.short} | Musical Trip Planner`;
  const descBits = [
    mats.length ? `Matinee ${clock(mats[0].time)} on ${daysText(mats[0].days)}${mins ? `, ending about ${ends(mats[0].time)}` : ""}.` : "",
    eves.length ? `Evening ${clock(eves[0].time)} on ${daysText(eves[0].days)}${mins ? `, ending about ${ends(eves[0].time)}` : ""}.` : "",
    show.runtime ? `Running time ${show.runtime}.` : ""
  ].filter(Boolean).join(" ");
  const description = (descBits ? `${show.title} at ${venue}, ${c.short}. ${descBits} ${show.blurb}` : `${show.title} at ${venue}: upcoming ${c.short} matinee and evening times, theatre address and similar shows. ${show.blurb}`).slice(0, 300);
  const canonical = `/${citySlug}/${show.id}/`;
  const jsonld = [breadcrumbLd([{ name: "Planner", href: "/" }, { name: c.hub, href: `/${citySlug}/` }, { name: show.title, href: canonical }])];
  if (faq.length) jsonld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  for (const p of perfs.slice(0, 10)) {
    if (!p.dateTime) continue;
    jsonld.push({
      "@context": "https://schema.org", "@type": "TheaterEvent", name: show.title, startDate: p.dateTime,
      eventStatus: p.status === "cancelled" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", description: show.blurb,
      location: { "@type": "PerformingArtsTheater", name: p.venue || show.venue, address: p.address || c.tm.city },
      ...(p.url ? { offers: { "@type": "Offer", url: p.url, availability: "https://schema.org/InStock" } } : {})
    });
  }
  return layout({ title, description, canonical, h1: show.title, lead: `${venue} · ${c.label}`, crumbs: [{ name: c.hub, href: `/${citySlug}/` }, { name: show.title }], body, jsonld, h1NoTranslate: true });
}

// ---------- city hub ----------
export function renderCity(citySlug) {
  const c = CITIES[citySlug];
  if (!c) return null;
  const shows = [...guide(citySlug)].sort((a, b) => a.title.localeCompare(b.title));
  const musicals = shows.filter(s => kindOf(s) === "musical");
  const running = musicals.filter(s => s.status !== "upcoming" && !isPastBooking(s) && !s.offBroadway);
  const upcoming = musicals.filter(s => s.status === "upcoming" && !isPastBooking(s) && !s.offBroadway);
  const offBway = musicals.filter(s => s.offBroadway && !isPastBooking(s));
  const extras = ["play", "spectacular", "family"].map(k => [k, shows.filter(s => kindOf(s) === k && !isPastBooking(s))]).filter(([, l]) => l.length);
  const cards = list => `<div class="grid">${list.map(g => `<div class="card"><h3 translate="no"><a href="/${citySlug}/${esc(g.id)}/">${esc(g.title)}</a></h3><div class="muted" translate="no">${esc(g.venue)}${g.limitedRun && g.dates ? " · " + esc(g.dates) : ""}</div><div class="pills">${[AUD[g.audience], ...(g.vibes || []).map(v => VIBE[v])].filter(Boolean).map(p => `<span class="pill">${esc(p)}</span>`).join("")}</div><p>${esc(g.blurb)}</p></div>`).join("")}</div>`;
  const body = `
<p>Every musical in our ${esc(c.short)} guide, with a short description, the theatre and upcoming performance times${extras.length ? ", plus the big plays and spectaculars many visitors fit into the same trip" : ""}. Not sure what to pick? The planner's <a href="/#/helper">Help me choose</a> quiz suggests shows in about a minute.</p>
<div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug))}">Plan your ${esc(c.short)} theatre trip</a><a class="btn" href="/${citySlug}/matinees/">${esc(AREA[citySlug])} matinees by day</a><a class="btn" href="/guides/">Read our guides</a></div>
<h2>Now playing</h2>
${cards(running)}
${upcoming.length ? `<h2>Coming soon</h2>${cards(upcoming)}` : ""}
${extras.map(([k, l]) => `<h2>${esc(KINDS[k].plural)}</h2>${k === "play" ? `<p>Not musicals, but the plays visitors most often plan a day around. ${citySlug === "london" ? "Harry Potter and the Cursed Child is two parts, an afternoon and an evening, which the planner treats like a matinee and an evening show." : ""}</p>` : ""}${cards(l)}`).join("")}
${offBway.length ? `<h2>Off-Broadway</h2><p>Smaller theatres away from the Broadway houses, often cheaper and more intimate. The planner's live schedule covers Broadway only, so check performance times on each show's page.</p>${cards(offBway)}` : ""}
<p class="note">${esc(DISCLAIMER)}</p>`;
  const canonical = `/${citySlug}/`;
  return layout({
    title: `${c.hub}: what's on, times & theatres | Musical Trip Planner`,
    description: `All ${c.hub.toLowerCase()} in one place: short descriptions, theatres and upcoming performance times, plus a free planner for fitting a matinee and an evening show into each day.`,
    canonical, h1: `${c.hub}: what's on`, lead: `${running.length} musicals now playing${upcoming.length ? ` · ${upcoming.length} coming soon` : ""}${extras.length ? ` · ${extras.reduce((n, [, l]) => n + l.length, 0)} plays & spectaculars` : ""}`,
    crumbs: [{ name: c.hub }], body,
    jsonld: [breadcrumbLd([{ name: "Planner", href: "/" }, { name: c.hub, href: canonical }]), { "@context": "https://schema.org", "@type": "ItemList", itemListElement: running.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/${citySlug}/${g.id}/`, name: g.title })) }]
  });
}

// ---------- matinees by day ----------
// data: output of loadSchedule() (lib/schedule-data.js): the planner's live schedule for 7 days.
const AREA = { london: "West End", "new-york": "Broadway" };
const longDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
const GENERIC_VENUE = /^(london|broadway, new york|new york)$/i;
// Listing sites decorate names ("Disney's The Lion King", "Hamilton on Broadway", "Galileo the Musical").
const cleanListingName = n => String(n || "").replace(/^disney'?s\s+/i, "").replace(/\s+on broadway$/i, "").replace(/[:\s-]+the musical$/i, "").trim();
const matchListing = (citySlug, name) => entryForName(citySlug, name) || entryForName(citySlug, cleanListingName(name));

// Names the guide check ignores (plays, concerts, circus shows the listing sites file under
// "musicals"): never shown on the matinee grid. Same file and rules as lib/guide-check.js.
export function ignoredListingKeys(citySlug) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "guide-ignore.json"), "utf8"));
    const today = new Date().toISOString().slice(0, 10);
    return new Set((j[CITIES[citySlug].data] || [])
      .filter(x => typeof x === "string" || (x && x.name && (!x.until || x.until >= today)))
      .map(x => key(typeof x === "string" ? x : x.name)).filter(Boolean));
  } catch { return new Set(); }
}

export function matineeWeek(citySlug, data) {
  const showInfo = new Map((data.shows || []).map(s => [s.name, s]));
  const ignored = ignoredListingKeys(citySlug);
  const dates = Object.keys(data.schedule || {}).sort();
  const playing = new Set();            // every show with any performance this week
  const byDay = new Map(WEEK.map(d => [d, { date: "", rows: [] }]));
  for (const date of dates) {
    const day = byDay.get(weekday(date));
    if (!day || day.date) continue;     // 7-day window: one date per weekday
    day.date = date;
    const seen = new Map();
    for (const [name, time] of data.schedule[date] || []) {
      const g = matchListing(citySlug, name);
      // Off-Broadway shows are not on the Broadway grid (the footer says so); ignored names are not musicals.
      if (g ? (g.offBroadway || kindOf(g) !== "musical") : (ignored.has(key(name)) || ignored.has(key(cleanListingName(name))))) continue;
      const k = g ? g.id : key(name);
      playing.add(k);
      if (!/^\d{2}:\d{2}$/.test(time) || !isMatinee(time)) continue;
      const row = seen.get(k) || { key: k, title: g?.title || name, id: g?.id || "", venue: g?.venue || (GENERIC_VENUE.test(showInfo.get(name)?.venue || "") ? "" : showInfo.get(name)?.venue || ""), mins: runtimeMinutes(g?.runtime), times: [] };
      if (!row.times.includes(time)) row.times.push(time);
      seen.set(k, row);
    }
    day.rows = [...seen.values()].map(r => ({ ...r, times: r.times.sort() }))
      .sort((a, b) => a.times[0].localeCompare(b.times[0]) || a.title.localeCompare(b.title));
  }
  return { byDay, playing: playing.size, start: data.start, end: data.end, refreshedAt: data.refreshedAt };
}

export function renderMatinees(citySlug, data) {
  const c = CITIES[citySlug];
  if (!c) return null;
  const area = AREA[citySlug];
  const wk = matineeWeek(citySlug, data);
  const days = WEEK.map(d => ({ name: d, ...wk.byDay.get(d) })).filter(d => d.date);
  const range = `${longDate(wk.start)} – ${longDate(wk.end)} ${wk.end.slice(0, 4)}`;
  const withMat = days.filter(d => d.rows.length);
  const busiest = [...withMat].sort((a, b) => b.rows.length - a.rows.length)[0];
  // Most common matinee start time across the week.
  const startCount = {};
  for (const d of days) for (const r of d.rows) for (const t of r.times) startCount[t] = (startCount[t] || 0) + 1;
  const starts = Object.entries(startCount).sort((a, b) => b[1] - a[1]);
  const totalMat = starts.reduce((s, [, n]) => s + n, 0);
  const anyShowWithMat = new Set(days.flatMap(d => d.rows.map(r => r.key))).size;

  const strip = `<div class="daystrip">${days.map(d => `<a href="#${d.name.toLowerCase()}"${d.rows.length ? "" : ' class="none"'}><b>${d.name.slice(0, 3)}</b><span>${d.rows.length}</span></a>`).join("")}</div>`;
  const facts = [
    busiest ? `<b>${esc(busiest.name)}</b> is the busiest matinee day: ${busiest.rows.length} of the ${wk.playing} musicals playing this week have a ${esc(busiest.name)} matinee.` : "",
    starts.length ? `The most common matinee start time is <b>${esc(clock(starts[0][0]))}</b> (${starts[0][1]} of ${totalMat} matinees)${starts[1] ? `, followed by ${esc(clock(starts[1][0]))}` : ""}.` : "",
    `${anyShowWithMat} of ${wk.playing} musicals have at least one matinee this week.`
  ].filter(Boolean);

  const sections = days.map(d => {
    const head = `<h2 id="${d.name.toLowerCase()}">${esc(d.name)} matinees <span class="muted" style="font:400 16px Inter,system-ui,sans-serif">· ${esc(longDate(d.date))}</span></h2>`;
    if (!d.rows.length) return `${head}<p class="muted">No musical matinees are listed on ${esc(d.name)} ${esc(longDate(d.date))}.</p>`;
    const rows = d.rows.map(r => `<tr><td translate="no">${r.id ? `<a href="/${citySlug}/${esc(r.id)}/">${esc(r.title)}</a>` : esc(r.title)}</td><td class="nw">${r.times.map(t => esc(clock(t))).join("<br>")}</td><td class="nw">${r.mins ? r.times.map(t => esc(clock(addMin(t, r.mins)))).join("<br>") : '<span class="muted">–</span>'}</td><td class="venue" translate="no">${esc(r.venue)}</td></tr>`).join("");
    return `${head}<p>${d.rows.length} musical${d.rows.length === 1 ? "" : "s"} with a ${esc(d.name)} matinee.</p><div class="card"><table><thead><tr><th>Show</th><th>Starts</th><th>Ends about</th><th class="venue">Theatre</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join("\n");

  // Quick answers for "which <area> musicals have a <day> matinee" searches.
  const faq = withMat.map(d => {
    const names = d.rows.map(r => `${r.title} (${r.times.map(clock).join(", ")})`);
    const list = names.length > 15 ? `${names.slice(0, 15).join(", ")} and ${names.length - 15} more` : andList(names);
    return [`Which ${area} musicals have a matinee on ${d.name}?`, `For ${d.name} ${longDate(d.date)}: ${list}.`];
  });
  // Finish-time range from this week's matinees that have a known running time.
  const ends = days.flatMap(d => d.rows.flatMap(r => r.mins ? r.times.map(t => addMin(t, r.mins)) : [])).sort();
  const endText = ends.length >= 3 ? ` This week's matinees finish between about ${clock(ends[0])} and ${clock(ends[ends.length - 1])}, so most leave time for an evening show.` : "";
  if (starts.length) faq.push([`What time do ${area} matinees start?`, `Most ${area} matinees start at ${clock(starts[0][0])}${starts[1] ? `; others start at ${starts.slice(1, 4).map(([t]) => clock(t)).join(", ")}` : ""}.${endText}`]);
  const faqHtml = faq.length ? `<h2>Quick answers</h2><div class="card faq">${faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join("")}</div>` : "";

  const updated = new Date(wk.refreshedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const body = `
<p>Which ${esc(area)} musicals have a matinee on each day of the week, with start times and roughly when each show finishes. A matinee here is any performance starting before 5 pm. This page covers <b>${esc(range)}</b> and updates automatically from the same live listings the planner uses.</p>
${strip}
${facts.length ? `<div class="card"><ul style="margin:0;padding-left:20px">${facts.map(f => `<li>${f}</li>`).join("")}</ul></div>` : ""}
<div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug))}">Plan a matinee and an evening show</a><a class="btn" href="/guides/two-shows-one-day/">How to see two shows in one day</a></div>
${sections}
${faqHtml}
<p class="note">Times last checked ${esc(updated)}. They come from public listings and can change, so always confirm with the theatre or ticket seller before booking. Finish times add each show's published running time to the start time.${citySlug === "new-york" ? " Broadway shows only; Off-Broadway shows are on their own pages." : ""} Musicals only: plays such as Harry Potter and the Cursed Child are listed on the <a href="/${citySlug}/">${esc(AREA[citySlug])} guide</a>. Musical Trip Planner is a free planning tool, not a ticket seller.</p>`;

  const canonical = `/${citySlug}/matinees/`;
  const jsonld = [breadcrumbLd([{ name: "Planner", href: "/" }, { name: c.hub, href: `/${citySlug}/` }, { name: "Matinees by day", href: canonical }])];
  if (faq.length) jsonld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
  const dayCounts = withMat.map(d => `${d.name} ${d.rows.length}`).join(", ");
  return layout({
    title: `${area} matinees by day: which musicals play Wednesday, Thursday, Saturday & Sunday | Musical Trip Planner`,
    description: `${area} musical matinees for each day of the week, with start and finish times. This week: ${dayCounts || "see the daily lists"}. Updated automatically from live listings.`.slice(0, 300),
    canonical, h1: `${area} matinees by day`, lead: `Which musicals have a matinee on each day · ${range}`,
    crumbs: [{ name: c.hub, href: `/${citySlug}/` }, { name: "Matinees by day" }], body, jsonld
  });
}

// ---------- guides ----------
export function renderGuide(slug) {
  const g = GUIDES.find(x => x.slug === slug);
  if (!g) return null;
  const canonical = `/guides/${g.slug}/`;
  const body = `${g.intro ? `<p style="font-size:17px">${g.intro}</p>` : ""}
${g.sections.map(s => `<h2>${esc(s.h)}</h2>${s.html}`).join("\n")}
${g.faq?.length ? `<h2>Frequently asked questions</h2><div class="faq">${g.faq.map(f => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}</div>` : ""}
<div class="cta"><a class="btn primary" href="/#/plan">Open the free trip planner</a><a class="btn" href="/guides/">More guides</a></div>
<p class="note">Last reviewed ${esc(g.updated)}. Schedules vary by show and season; always check the ticket seller before booking.</p>`;
  const jsonld = [
    breadcrumbLd([{ name: "Planner", href: "/" }, { name: "Guides", href: "/guides/" }, { name: g.title, href: canonical }]),
    { "@context": "https://schema.org", "@type": "Article", headline: g.title, description: g.description, dateModified: g.updated, author: { "@type": "Person", name: "Yuval Beck" }, publisher: { "@type": "Organization", name: "Musical Trip Planner", url: SITE } }
  ];
  if (g.faq?.length) jsonld.push({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: g.faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  return layout({ title: `${g.title} | Musical Trip Planner`, description: g.description, canonical, h1: g.title, lead: g.lead, crumbs: [{ name: "Guides", href: "/guides/" }, { name: g.title }], body, jsonld });
}

export function renderGuidesIndex() {
  const body = `<div class="grid">${GUIDES.map(g => `<div class="card"><h3><a href="/guides/${esc(g.slug)}/">${esc(g.title)}</a></h3><p>${esc(g.description)}</p></div>`).join("")}</div>
<h2>Browse the shows</h2><div class="cta"><a class="btn" href="/london/">West End musicals</a><a class="btn" href="/new-york/">Broadway musicals</a><a class="btn primary" href="/#/plan">Open the planner</a></div>`;
  return layout({ title: "Theatre trip guides: West End & Broadway | Musical Trip Planner", description: "Practical guides for planning a musical-theatre trip to London's West End or New York's Broadway: show times, matinees, seeing two shows in a day and more.", canonical: "/guides/", h1: "Theatre trip guides", lead: "Practical tips for West End and Broadway trips", crumbs: [{ name: "Guides" }], body, jsonld: [breadcrumbLd([{ name: "Planner", href: "/" }, { name: "Guides", href: "/guides/" }])] });
}

// ---------- about & contact ----------
const ABOUT_CSS = `
.about p{font-size:16.5px}
form.fb{display:grid;gap:12px;margin-top:6px}
form.fb label{font-weight:600;font-size:14px;display:grid;gap:6px}
form.fb .opt{font-weight:400;color:var(--muted)}
form.fb select,form.fb input,form.fb textarea{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--ink);width:100%}
form.fb textarea{min-height:140px;resize:vertical}
form.fb .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
form.fb button{justify-self:start;cursor:pointer}
form.fb button[disabled]{opacity:.6;cursor:wait}
.fb-status{margin:4px 0 0;font-weight:600}
.fb-status.ok{color:var(--green)}.fb-status.err{color:var(--accent)}
`;

export function renderAbout() {
  const topics = [["wrong", "Wrong or missing show / time"], ["idea", "Idea or feature request"], ["bug", "Something doesn't work"], ["other", "Other"]];
  const body = `<style>${ABOUT_CSS}</style>
<div class="about">
<h2>Who we are</h2>
<p>We're Yuval and Liesl, two musical enthusiasts who plan our trips around shows. Whenever we visited London or New York, we wanted to see as many musicals as we could, ideally a matinee and an evening show on the same day.</p>
<h2>Why we built it</h2>
<p>Planning that turned out to be surprisingly hard. Each website showed one piece of the puzzle: one listed what's on, another had performance times, a third sold tickets. None of them answered the simple question: <i>"We're here from the 9th to the 15th. What can we actually see, and which shows fit together on the same day?"</i></p>
<p>So we built the tool we wanted. You pick your dates, see only the shows playing then, pair matinees with evening performances, and export or share the finished plan. It's free, and there's nothing to sign up for.</p>
<h2>How the schedules work</h2>
<p>When you choose your dates, the planner looks up current performance listings for those exact days, so you see what is actually playing rather than a generic weekly pattern. The <a href="/london/">West End</a> and <a href="/new-york/">Broadway</a> show pages use performance data from Ticketmaster where it's available. We write the show descriptions ourselves.</p>
<p>Schedules can change at short notice, so always confirm times with the ticket seller or the theatre before you book. We don't sell tickets: ticket links take you to independent sellers, and some are affiliate links that may earn us a small commission at no extra cost to you. Commissions never affect which shows the planner suggests.</p>
<h2>Your privacy</h2>
<p>There are no accounts and no sign-up. Your chosen shows, dates and any ticket confirmations you add stay in your own browser, on your device. When you press <i>Share plan</i>, we store a copy of the itinerary so the link works, but never your ticket confirmations. We use privacy-friendly analytics that count visits without cookies. If you send us feedback, we keep your message and, if you choose to give it, your email address so we can reply.</p>
<h2 id="contact">Get in touch</h2>
<p>Found a wrong time, a missing show, or have an idea? Use the form below, or email <a href="mailto:info@musicaltripplanner.com">info@musicaltripplanner.com</a>.</p>
</div>
<div class="card">
<form class="fb" id="fb" novalidate>
<label>What's it about?<select name="topic">${topics.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>
<label>Your message<textarea name="message" required maxlength="4000" placeholder="e.g. Hadestown's Sunday matinee time looks wrong for 12 October"></textarea></label>
<label>Your email <span class="opt">(optional, only if you'd like a reply)</span><input type="email" name="email" autocomplete="email" maxlength="254"></label>
<div class="hp" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<button type="submit" class="btn primary">Send message</button>
<p class="fb-status" id="fb-status" role="status" aria-live="polite"></p>
</form>
</div>
<div class="cta"><a class="btn primary" href="/#/plan">Open the planner</a><a class="btn" href="/guides/">Read our guides</a></div>
<script>
(function(){
  var f=document.getElementById('fb'),st=document.getElementById('fb-status');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var msg=f.message.value.trim();
    if(msg.length<5){st.className='fb-status err';st.textContent='Please write a few words.';f.message.focus();return;}
    var b=f.querySelector('button');b.disabled=true;st.className='fb-status';st.textContent='Sending…';
    fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:f.topic.value,message:msg,email:f.email.value.trim(),website:f.website.value,page:document.referrer||location.pathname})})
      .then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,j:j};});})
      .then(function(x){
        if(x.ok){f.reset();st.className='fb-status ok';st.textContent='Thank you! Your message has been sent.';try{window.va&&window.va('event',{name:'feedback_sent'});}catch(_){}}
        else{st.className='fb-status err';st.textContent=(x.j&&x.j.error)||'Sorry, something went wrong. Please email info@musicaltripplanner.com.';}
      })
      .catch(function(){st.className='fb-status err';st.textContent='Sorry, the message could not be sent. Please email info@musicaltripplanner.com.';})
      .then(function(){b.disabled=false;});
  });
})();
</script>`;
  const canonical = "/about/";
  const jsonld = [
    breadcrumbLd([{ name: "Planner", href: "/" }, { name: "About", href: canonical }]),
    { "@context": "https://schema.org", "@type": "AboutPage", name: "About Musical Trip Planner", url: SITE + canonical,
      about: { "@type": "Organization", name: "Musical Trip Planner", url: SITE, email: "info@musicaltripplanner.com",
        founder: [{ "@type": "Person", name: "Yuval" }, { "@type": "Person", name: "Liesl" }] } }
  ];
  return layout({
    title: "About & contact | Musical Trip Planner",
    description: "Musical Trip Planner is a free tool by two musical enthusiasts, Yuval and Liesl, for planning West End and Broadway trips: see what plays on your dates and pair matinee and evening shows.",
    canonical, h1: "About Musical Trip Planner", lead: "Made by two musical fans who wanted an easier way to plan theatre trips",
    crumbs: [{ name: "About" }], body, jsonld
  });
}

// ---------- sitemap (used at build time) ----------
export function sitemapXml(today = new Date().toISOString().slice(0, 10)) {
  const urls = [{ loc: "/", pr: "1.0", cf: "weekly" }, { loc: "/london/", pr: "0.8", cf: "daily" }, { loc: "/new-york/", pr: "0.8", cf: "daily" }, { loc: "/london/matinees/", pr: "0.7", cf: "daily" }, { loc: "/new-york/matinees/", pr: "0.7", cf: "daily" }, { loc: "/guides/", pr: "0.6", cf: "monthly" }, { loc: "/about/", pr: "0.4", cf: "monthly" }];
  for (const citySlug of Object.keys(CITIES)) for (const g of guide(citySlug)) urls.push({ loc: `/${citySlug}/${g.id}/`, pr: "0.7", cf: "daily" });
  for (const g of GUIDES) urls.push({ loc: `/guides/${g.slug}/`, pr: "0.6", cf: "monthly" });
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.cf}</changefreq><priority>${u.pr}</priority></url>`).join("\n")}
</urlset>
`;
}

export function notFound() {
  return layout({ title: "Page not found | Musical Trip Planner", description: "This page does not exist.", canonical: "/", h1: "Page not found", lead: "", body: `<p>We couldn't find that page.</p><div class="cta"><a class="btn primary" href="/#/plan">Open the planner</a><a class="btn" href="/london/">West End musicals</a><a class="btn" href="/new-york/">Broadway musicals</a></div>` });
}
