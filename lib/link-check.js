// Nightly ticket-link check (2026-11-10, requested by Yuval after two wrong-landing reports:
// Masquerade -> SeatPlan's city page in Oct, Maybe Happy Ending / Schmigadoon -> the show overview
// instead of the chosen date in Nov).
//
// GET /api/stats?report=links   (Vercel cron, once a day, see vercel.json)
// For every show in the next few days' live schedule (London and New York) it takes the next two
// performances and builds exactly the links the planner shows:
//   SeatPlan     .../<show>-tickets/tickets/14-nov-2026/7-30pm/   -> opened for real. Passes only if
//                the page loads, SeatPlan didn't redirect it to another page, and the page title
//                names that date and time ("Schmigadoon! in New York, 14 Nov 2026, 7:30pm").
//   Ticketmaster the event URL /api/tm-link would give for that performance -> must be a
//                ticketmaster.com / .co.uk "/event/<id>" page (Ticketmaster blocks automated page
//                loads, so only the address is checked, not the page).
// Results go into Neon (table link_checks) and the next daily stats email reports them.
// lib/go.js reads the last run: a show whose SeatPlan date page failed is sent to its SeatPlan
// show page instead, so a visitor never lands on a wrong or general page.
import { neon } from "@neondatabase/serverless";
import { seatPlanPerformanceUrl } from "./seatplan.js";
import { entryForName, showPerformances } from "./site-pages.js";
import { pickPerformance } from "../api/tm-link.js";

const SITE = "https://musicaltripplanner.com";
const DAY = 86400000;
const ymd = t => new Date(t).toISOString().slice(0, 10);
const errText = e => String((e && e.message) || e).slice(0, 200);
const CITY_SLUG = { london: "london", broadway: "new-york" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PER_SHOW = 2;          // performances checked per show
const WINDOW_DAYS = 3;       // tomorrow + the two days after
const CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 9000;
const BUDGET_MS = 48000;     // stats.js has 60 s; whatever isn't reached by then is "not checked"

let sqlClient;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

// "2026-11-14", "19:30" -> ["14 Nov 2026", "7:30pm"]: how SeatPlan writes them in the page title.
export function seatPlanTitleParts(date, time) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ""), t = /^(\d{1,2}):(\d{2})/.exec(time || "");
  if (!d || !t) return null;
  const h = Number(t[1]);
  return [`${Number(d[3])} ${MONTHS[Number(d[2]) - 1]} ${d[1]}`, `${h % 12 || 12}:${t[2]}${h < 12 ? "am" : "pm"}`];
}

// The SeatPlan show page a performance URL belongs to (…/x-tickets/tickets/…/ -> …/x-tickets/).
export function seatPlanShowPage(url) {
  const m = /^(https:\/\/seatplan\.com\/(?:london|new-york)\/[^/?#]+-tickets\/)tickets\/[^/]+\/[^/]+\/?(?:[?#].*)?$/i.exec(String(url || ""));
  return m ? m[1] : "";
}

// Judges one fetched SeatPlan page. result: ok | fail | blocked (SeatPlan refused the robot; says
// nothing about the link, so it never triggers the fallback).
export function judgeSeatPlan({ status, finalUrl, html }, wantedUrl, date, time) {
  if (status === 403 || status === 429 || status === 503 || /just a moment|attention required|captcha/i.test(html.slice(0, 3000)))
    return { result: "blocked", detail: `SeatPlan refused the check (HTTP ${status})` };
  if (status === 404 || status === 410) return { result: "fail", detail: `page not found (HTTP ${status})` };
  if (status !== 200) return { result: "fail", detail: `HTTP ${status}` };
  const path = u => { try { return new URL(u).pathname.replace(/\/?$/, "/"); } catch { return ""; } };
  // Some shows (ABBA Voyage, Just In Time) send the date link straight to SeatPlan's seat picker for
  // that performance: book.seatplan.com / broadway.seatplan.com/booking/seating-plan?…&slot=19:45&date=2026-11-11.
  // That is the right place (better than the date page), as long as date and slot match.
  if (isSeatPickerFor(finalUrl, date, time)) return { result: "ok", detail: "" };
  if (path(finalUrl) !== path(wantedUrl)) return { result: "fail", detail: `redirected to ${finalUrl}` };
  const title = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const parts = seatPlanTitleParts(date, time);
  const t = title.toLowerCase();
  if (!parts || !t.includes(parts[0].toLowerCase()) || !t.includes(parts[1].toLowerCase()))
    return { result: "fail", detail: `page is not that performance (title: "${title.slice(0, 120)}")` };
  return { result: "ok", detail: "" };
}

export function isSeatPickerFor(url, date, time) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^([a-z0-9-]+\.)*seatplan\.com$/i.test(u.hostname) || !/^\/booking\/seating-plan\/?$/.test(u.pathname)) return false;
  const slot = String(u.searchParams.get("slot") || "").padStart(5, "0");
  return u.searchParams.get("date") === date && slot === String(time || "").padStart(5, "0");
}

export function judgeTicketmaster(url) {
  if (!url) return { result: "skipped", detail: "Ticketmaster doesn't sell this performance" };
  return /^https:\/\/www\.ticketmaster\.(com|co\.uk)\/(?:[^?#]*\/)?event\/[A-Za-z0-9]+(?:[?#].*)?$/.test(url)
    ? { result: "ok", detail: "" }
    : { result: "fail", detail: `not an event page: ${url.slice(0, 160)}` };
}

async function fetchPage(url, fetchImpl) {
  const r = await fetchImpl(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-GB,en;q=0.9"
    },
    redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const html = await r.text();
  return { status: r.status, finalUrl: r.url || url, html };
}

// Next PER_SHOW performances per show with a SeatPlan link, from our own live schedule API.
export function performancesToCheck(data) {
  const out = [];
  for (const show of data.shows || []) {
    const ticketUrl = String(show.ticketUrl || "");
    const perfs = [];
    for (const date of Object.keys(data.schedule || {}).sort()) {
      for (const entry of data.schedule[date] || []) {
        if (entry[0] === show.name && !(entry[2] && entry[2].soldOut)) perfs.push({ date, time: entry[1] });
      }
    }
    perfs.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (const p of perfs.slice(0, PER_SHOW)) out.push({ show: show.name, ticketUrl, date: p.date, time: p.time });
  }
  return out;
}

async function pool(items, n, fn, deadline) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      if (Date.now() > deadline) { results[i] = null; continue; }
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

export async function runLinkCheck({ now = Date.now(), fetchImpl = fetch, store = true } = {}) {
  const started = Date.now(), deadline = started + BUDGET_MS;
  const start = ymd(now + DAY), end = ymd(now + WINDOW_DAYS * DAY);
  const rows = [], errors = [];
  const schedules = await Promise.all(Object.keys(CITY_SLUG).map(async city => {
    try {
      const r = await fetchImpl(`${SITE}/api/schedule?city=${city}&start=${start}&end=${end}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`schedule ${r.status}`);
      return { city, data: await r.json() };
    } catch (e) { errors.push(`${city} schedule: ${errText(e)}`); return { city, data: null }; }
  }));

  const jobs = [];
  for (const { city, data } of schedules) {
    if (!data) continue;
    for (const p of performancesToCheck(data)) jobs.push({ city, ...p });
  }

  const tmCache = new Map();
  const checked = await pool(jobs, CONCURRENCY, async job => {
    const out = [];
    // SeatPlan: the same link the planner builds, opened for real.
    if (/^https:\/\/seatplan\.com\//i.test(job.ticketUrl)) {
      const url = seatPlanPerformanceUrl(job.ticketUrl, job.date, job.time);
      let v;
      try { v = judgeSeatPlan(await fetchPage(url, fetchImpl), url, job.date, job.time); }
      catch (e) { v = { result: "blocked", detail: `couldn't load: ${errText(e)}` }; }
      out.push({ seller: "seatplan", url, ...v });
    }
    // Ticketmaster: the event /api/tm-link would pick for this performance.
    const citySlug = CITY_SLUG[job.city], entry = entryForName(citySlug, job.show);
    if (entry) {
      const key = `${citySlug}:${entry.id}`;
      if (!tmCache.has(key)) tmCache.set(key, showPerformances(citySlug, entry, { start: ymd(Date.parse(start) - DAY), days: WINDOW_DAYS + 2 }).catch(() => ({ ok: false })));
      const tm = await tmCache.get(key);
      if (tm.ok) {
        const p = pickPerformance(tm.performances, job.date, job.time);
        const v = judgeTicketmaster(p ? p.url : "");
        if (v.result !== "skipped") out.push({ seller: "ticketmaster", url: p.url, ...v });
      }
    }
    return out;
  }, deadline);

  let notChecked = 0;
  jobs.forEach((job, i) => {
    if (!checked[i]) { notChecked++; return; }
    for (const c of checked[i]) rows.push({ city: job.city, show: job.show, date: job.date, time: job.time, ...c });
  });

  const report = {
    kind: "mtp-link-check", version: 1, runAt: new Date(now).toISOString(), window: { start, end },
    seconds: Math.round((Date.now() - started) / 1000), notChecked, errors,
    counts: countRows(rows), failures: rows.filter(r => r.result === "fail"), rows
  };
  if (store) {
    try { await storeRun(report); } catch (e) { report.errors.push(`store: ${errText(e)}`); }
  }
  return report;
}

export function countRows(rows) {
  const c = { ok: 0, fail: 0, blocked: 0 };
  for (const r of rows) c[r.result] = (c[r.result] || 0) + 1;
  return c;
}

async function ensureTable(db) {
  await db`CREATE TABLE IF NOT EXISTS link_checks (
    run_at timestamptz NOT NULL, city text NOT NULL, show text NOT NULL, perf_date date, perf_time text,
    seller text NOT NULL, url text NOT NULL, result text NOT NULL, detail text NOT NULL DEFAULT '')`;
  await db`CREATE INDEX IF NOT EXISTS link_checks_run_at ON link_checks (run_at)`;
}

async function storeRun(report) {
  const db = sql();
  await ensureTable(db);
  await db`DELETE FROM link_checks WHERE run_at < now() - interval '30 days'`;
  const rows = report.rows;
  // A run with nothing checked (both schedules down) is still stored as one marker row, so the
  // daily email can say "the check ran but found nothing to check".
  if (!rows.length) {
    await db`INSERT INTO link_checks (run_at, city, show, seller, url, result, detail)
      VALUES (${report.runAt}, '', '', 'none', '', 'none', ${report.errors.join("; ").slice(0, 500)})`;
    return;
  }
  await db`INSERT INTO link_checks (run_at, city, show, perf_date, perf_time, seller, url, result, detail)
    SELECT ${report.runAt}::timestamptz, c, s, d::date, t, se, u, r, de FROM unnest(
      ${rows.map(r => r.city)}::text[], ${rows.map(r => r.show)}::text[], ${rows.map(r => r.date)}::text[],
      ${rows.map(r => r.time)}::text[], ${rows.map(r => r.seller)}::text[], ${rows.map(r => r.url)}::text[],
      ${rows.map(r => r.result)}::text[], ${rows.map(r => r.detail)}::text[]) AS x(c, s, d, t, se, u, r, de)`;
}

// The newest run, for the daily email. null when no run in the last 36 hours.
export async function latestLinkCheck() {
  const db = sql();
  await ensureTable(db);
  const rows = await db`SELECT to_char(run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS run_at, city, show,
      to_char(perf_date, 'YYYY-MM-DD') AS date, perf_time AS time, seller, url, result, detail
    FROM link_checks WHERE run_at = (SELECT max(run_at) FROM link_checks) AND run_at > now() - interval '36 hours'`;
  if (!rows.length) return null;
  const real = rows.filter(r => r.result !== "none");
  return { runAt: rows[0].run_at, counts: countRows(real), failures: real.filter(r => r.result === "fail"), total: real.length, note: real.length ? "" : rows[0].detail };
}

// SeatPlan show pages whose date links failed in the newest run (lib/go.js fallback).
// Cached per server instance for 15 minutes; never throws.
let badCache = { at: 0, set: new Set() };
export async function failingSeatPlanShowPages() {
  if (Date.now() - badCache.at < 15 * 60 * 1000) return badCache.set;
  try {
    const db = sql();
    const rows = await db`SELECT DISTINCT url FROM link_checks
      WHERE seller = 'seatplan' AND result = 'fail' AND run_at = (SELECT max(run_at) FROM link_checks) AND run_at > now() - interval '36 hours'`;
    badCache = { at: Date.now(), set: new Set(rows.map(r => seatPlanShowPage(r.url)).filter(Boolean)) };
  } catch (e) {
    badCache = { at: Date.now(), set: badCache.set };
  }
  return badCache.set;
}

// Lines for the daily email.
export function linkCheckLines(lc) {
  if (!lc) return ["The nightly ticket-link check didn't run (no result in the last 36 hours)."];
  if (lc.error) return [`Ticket-link check: error ${lc.error}`];
  if (!lc.total) return [`Ticket-link check ran (${lc.runAt}) but found nothing to check${lc.note ? `: ${lc.note}` : ""}.`];
  const c = lc.counts;
  const L = [`Ticket-link check (${lc.runAt}): ${c.ok} OK · ${c.fail} failed${c.blocked ? ` · ${c.blocked} couldn't be checked (the site refused or timed out)` : ""}.`];
  for (const f of lc.failures.slice(0, 12)) {
    L.push(`FAILED ${f.seller === "seatplan" ? "SeatPlan" : "Ticketmaster"} · ${f.show} (${f.city === "london" ? "London" : "New York"}) ${f.date} ${f.time}: ${f.detail} — ${f.url}`);
  }
  if (lc.failures.length > 12) L.push(`…and ${lc.failures.length - 12} more (see the attached JSON).`);
  if (c.fail && lc.failures.some(f => f.seller === "seatplan")) L.push("Until it passes again, the SeatPlan button for those shows opens the show's SeatPlan page instead of the date.");
  return L;
}
