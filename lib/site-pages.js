// Server-rendered, indexable pages: one page per musical, a hub per city and the guide articles.
// Show descriptions come from data/shows-*.json. Performance times come from the licensed
// Ticketmaster Discovery API (env TICKETMASTER_API_KEY); shows Ticketmaster doesn't sell get the
// page without a timetable and a link to live times in the planner.
import fs from "node:fs";
import path from "node:path";
import { GUIDES } from "./guides-content.js";

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

// ---------- Ticketmaster ----------
const TM = "https://app.ticketmaster.com/discovery/v2/events.json";
const tmCache = new Map();
function tmKeyword(title) {
  return String(title).replace(/^&\s*/, "").replace(/\s*(:|-)?\s*the musical$/i, "").replace(/\s*\(.*\)\s*$/, "").trim();
}
function ymd(d) { return d.toISOString().slice(0, 19) + "Z"; }

export async function showPerformances(citySlug, show, { days = 35, fetchImpl = fetch } = {}) {
  const apikey = process.env.TICKETMASTER_API_KEY;
  if (!apikey) return { ok: false, reason: "no-key", performances: [] };
  const cacheKey = `${citySlug}:${show.id}`;
  const hit = tmCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;
  const now = new Date();
  const end = new Date(now.getTime() + days * 86400000);
  const u = new URL(TM);
  const params = { ...CITIES[citySlug].tm, keyword: tmKeyword(show.title), classificationName: "theatre", startDateTime: ymd(now), endDateTime: ymd(end), size: 200, sort: "date,asc", apikey };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  let value;
  try {
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Ticketmaster ${r.status}`);
    const j = await r.json();
    const events = (j._embedded?.events || []).filter(e => {
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
    value = { ok: true, performances };
  } catch (err) {
    console.error("ticketmaster failed", show.id, err?.message || err);
    value = { ok: false, reason: "error", performances: [] };
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
.pills{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.pill{font-size:12px;padding:4px 9px;border-radius:999px;background:#eee8df;color:#4a453e}
table{width:100%;border-collapse:collapse;font-size:15px}
th,td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:13px;color:var(--muted);font-weight:600}
td.t a{font-weight:600}
.muted{color:var(--muted)}
.note{color:var(--muted);font-size:13px;margin:26px 0 0}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.grid .card{margin:0}
.grid h3{margin:0 0 4px;font:700 19px/1.25 Georgia,serif}
.grid h3 a{text-decoration:none;color:var(--ink)}
.grid p{margin:6px 0 0;font-size:14px}
.faq h3{margin-top:14px}
footer{text-align:center;color:var(--muted);font-size:13px;padding:0 16px 30px}
footer a{color:var(--muted)}
@media(max-width:640px){.grid{grid-template-columns:1fr}th.venue,td.venue{display:none}}
`;

const SECTIONS = [{ name: "West End musicals", href: "/london/" }, { name: "Broadway musicals", href: "/new-york/" }, { name: "Trip guides", href: "/guides/" }];

function layout({ title, description, canonical, h1, lead, crumbs = [], body, jsonld = [] }) {
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
${ld}
<style>${CSS}</style></head>
<body>
<header><div class="wrap">
<div class="topbar"><a class="brand" href="/#/start">MUSICAL TRIP PLANNER</a><nav class="topnav" aria-label="Planner"><a href="/#/start">← Start screen</a><a class="go" href="/#/plan">Open the planner</a></nav></div>
<nav class="sections" aria-label="Sections">${SECTIONS.map(x => `<a href="${x.href}"${canonical.startsWith(x.href) ? ' aria-current="page"' : ""}>${x.name}</a>`).join("")}</nav>
<h1>${esc(h1)}</h1>${lead ? `<p>${esc(lead)}</p>` : ""}</div></header>
${crumbHtml}
<main>${body}</main>
<footer><a href="/london/">West End musicals</a> · <a href="/new-york/">Broadway musicals</a> · <a href="/guides/">Guides</a> · <a href="/#/plan">Open the planner</a></footer>
</body></html>`;
}

function breadcrumbLd(items) {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: SITE + it.href })) };
}

const VIBE = { spectacle: "Big spectacle", feelgood: "Feel-good", emotional: "Moving story", edgy: "Funny & irreverent" };
const AUD = { family: "Family-friendly", teens: "Teens and up", adults: "Adults" };
const DISCLAIMER = `Musical Trip Planner is a free planning tool, not a ticket seller. Performance times come from Ticketmaster's listings and can change; always check with the ticket seller before booking. Ticket links go to third-party sites, and some may be affiliate links that earn us a small commission at no extra cost to you. Show descriptions are our own short summaries.`;

const fmtDate = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const plannerLink = (citySlug, show) => `/?city=${CITIES[citySlug].data}${show ? "&show=" + encodeURIComponent(show.id) : ""}#/plan`;

// ---------- show page ----------
export async function renderShow(citySlug, id, opts = {}) {
  const c = CITIES[citySlug];
  const show = c && findShow(citySlug, id);
  if (!show) return null;
  const tm = await showPerformances(citySlug, show, opts);
  if (opts.meta) opts.meta.tmOk = tm.ok;
  const perfs = tm.performances;
  const venue = perfs[0]?.venue || show.venue;
  const address = perfs.find(p => p.address)?.address || "";
  const days = {};
  for (const p of perfs) (days[p.date] ||= []).push(p);
  const dayKeys = Object.keys(days).sort();
  const matinees = new Set(), evenings = new Set();
  for (const p of perfs) { const wd = new Date(p.date + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" }); (p.time && p.time < "17:00" ? matinees : evenings).add(wd); }
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const list = s => order.filter(d => s.has(d)).join(", ");

  const pills = [AUD[show.audience], ...(show.vibes || []).map(v => VIBE[v]), show.runtime].filter(Boolean);
  let times;
  if (dayKeys.length) {
    const rows = dayKeys.slice(0, 28).map(d => {
      const ps = days[d];
      const cell = sess => ps.filter(p => sess === "m" ? p.time && p.time < "17:00" : !(p.time && p.time < "17:00"))
        .map(p => p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener sponsored">${esc(p.time || "TBC")}</a>` : esc(p.time || "TBC")).join(" · ") || '<span class="muted">–</span>';
      return `<tr><td>${esc(fmtDate(d))}</td><td class="t">${cell("m")}</td><td class="t">${cell("e")}</td></tr>`;
    }).join("");
    times = `<p>${matinees.size ? `Matinees in the coming weeks fall on <b>${esc(list(matinees))}</b>. ` : "No matinees are listed in the coming weeks. "}${evenings.size ? `Evening performances on <b>${esc(list(evenings))}</b>.` : ""} Tap a time to see tickets.</p>
<div class="card"><table><thead><tr><th>Date</th><th>Matinee</th><th>Evening</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } else if (tm.ok) {
    times = `<div class="card"><p>No performances of ${esc(show.title)} are listed by our ticket-data partner for the next few weeks. ${show.status === "upcoming" && show.dates ? esc(show.dates) + ". " : ""}Many theatres sell their own tickets, so the show may still be on. The planner checks live listings for your exact dates.</p><div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug, show))}">Check live times in the planner</a></div></div>`;
  } else {
    times = `<div class="card"><p>Performance times are temporarily unavailable. The planner checks live listings for your exact dates.</p><div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug, show))}">Check live times in the planner</a></div></div>`;
  }

  // Shows that pair well: same city, sharing a vibe, playing the other session.
  const others = guide(citySlug).filter(g => g.id !== show.id && g.status !== "upcoming" && (g.vibes || []).some(v => (show.vibes || []).includes(v))).slice(0, 6);
  const othersHtml = others.length ? `<h2>If you like ${esc(show.title)}</h2><div class="grid">${others.map(g => `<div class="card"><h3><a href="/${citySlug}/${esc(g.id)}/">${esc(g.title)}</a></h3><div class="muted">${esc(g.venue)}</div><p>${esc(g.blurb)}</p></div>`).join("")}</div>` : "";

  const mapQ = encodeURIComponent([venue, address || c.tm.city].filter(Boolean).join(", "));
  const body = `
<div class="card">
<div class="pills">${pills.map(p => `<span class="pill">${esc(p)}</span>`).join("")}</div>
<p style="font-size:17px;margin:6px 0">${esc(show.blurb)}</p>
${show.limitedRun && show.dates ? `<p class="muted">Limited run · ${esc(show.dates)}</p>` : ""}
<div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug, show))}">Plan a trip around ${esc(show.title)}</a><a class="btn" href="https://open.spotify.com/search/${encodeURIComponent(show.listen || show.title)}" target="_blank" rel="noopener">Listen to the cast recording ↗</a></div>
</div>
<h2>Performance times</h2>
${times}
<h2>Theatre</h2>
<div class="card"><b>${esc(venue)}</b>${address ? `<br><span class="muted">${esc(address)}</span>` : ""}<br><a href="https://www.google.com/maps/search/?api=1&query=${mapQ}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>
<h2>Seeing two shows in one day?</h2>
<p>With a matinee and an evening performance you can fit two musicals into one day ${esc(c.area)}. The <a href="${esc(plannerLink(citySlug, show))}">trip planner</a> shows what else is playing on each date you're in town and warns you about clashes. Read <a href="/guides/two-shows-one-day/">how to see two shows in one day</a>.</p>
${othersHtml}
<p class="note">${esc(DISCLAIMER)}</p>`;

  const title = `${show.title} – performance times, theatre & tips | ${c.short} | Musical Trip Planner`;
  const description = `${show.title} at ${venue}: upcoming ${c.short} performance times, matinee days, theatre address and similar shows. ${show.blurb}`.slice(0, 300);
  const canonical = `/${citySlug}/${show.id}/`;
  const jsonld = [breadcrumbLd([{ name: "Planner", href: "/" }, { name: c.hub, href: `/${citySlug}/` }, { name: show.title, href: canonical }])];
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
  return layout({ title, description, canonical, h1: show.title, lead: `${venue} · ${c.label}`, crumbs: [{ name: c.hub, href: `/${citySlug}/` }, { name: show.title }], body, jsonld });
}

// ---------- city hub ----------
export function renderCity(citySlug) {
  const c = CITIES[citySlug];
  if (!c) return null;
  const shows = [...guide(citySlug)].sort((a, b) => a.title.localeCompare(b.title));
  const running = shows.filter(s => s.status !== "upcoming");
  const upcoming = shows.filter(s => s.status === "upcoming");
  const cards = list => `<div class="grid">${list.map(g => `<div class="card"><h3><a href="/${citySlug}/${esc(g.id)}/">${esc(g.title)}</a></h3><div class="muted">${esc(g.venue)}${g.limitedRun && g.dates ? " · " + esc(g.dates) : ""}</div><div class="pills">${[AUD[g.audience], ...(g.vibes || []).map(v => VIBE[v])].filter(Boolean).map(p => `<span class="pill">${esc(p)}</span>`).join("")}</div><p>${esc(g.blurb)}</p></div>`).join("")}</div>`;
  const body = `
<p>Every musical in our ${esc(c.short)} guide, with a short description, the theatre and upcoming performance times. Not sure what to pick? The planner's <a href="/#/helper">Help me choose</a> quiz suggests shows in about a minute.</p>
<div class="cta"><a class="btn primary" href="${esc(plannerLink(citySlug))}">Plan your ${esc(c.short)} theatre trip</a><a class="btn" href="/guides/">Read our guides</a></div>
<h2>Now playing</h2>
${cards(running)}
${upcoming.length ? `<h2>Coming soon</h2>${cards(upcoming)}` : ""}
<p class="note">${esc(DISCLAIMER)}</p>`;
  const canonical = `/${citySlug}/`;
  return layout({
    title: `${c.hub}: what's on, times & theatres | Musical Trip Planner`,
    description: `All ${c.hub.toLowerCase()} in one place: short descriptions, theatres and upcoming performance times, plus a free planner for fitting a matinee and an evening show into each day.`,
    canonical, h1: `${c.hub}: what's on`, lead: `${running.length} musicals now playing${upcoming.length ? ` · ${upcoming.length} coming soon` : ""}`,
    crumbs: [{ name: c.hub }], body,
    jsonld: [breadcrumbLd([{ name: "Planner", href: "/" }, { name: c.hub, href: canonical }]), { "@context": "https://schema.org", "@type": "ItemList", itemListElement: running.map((g, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/${citySlug}/${g.id}/`, name: g.title })) }]
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

// ---------- sitemap (used at build time) ----------
export function sitemapXml(today = new Date().toISOString().slice(0, 10)) {
  const urls = [{ loc: "/", pr: "1.0", cf: "weekly" }, { loc: "/london/", pr: "0.8", cf: "daily" }, { loc: "/new-york/", pr: "0.8", cf: "daily" }, { loc: "/guides/", pr: "0.6", cf: "monthly" }];
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
