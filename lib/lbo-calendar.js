// Fallback for musicals that London Box Office sells but leaves off its
// per-day search pages (seen with Rent in Sept 2026: bookable on 13 Oct,
// yet missing from /search/london-shows/2026/10/13/2).
//
// 1. The /musicals page carries JSON-LD with every musical LBO sells and the
//    URL of its show page (".../rent-tickets").
// 2. Each show has a month booking calendar at
//    /search/month/<slug>/YYYY/MM/01/2 whose cells read either
//    "13 October 19:30 From £87.00" or "1 October No online availability".
// Both page types are allowed by LBO's robots.txt. Results are cached per
// function instance so a trip search adds at most a handful of requests.
import * as cheerio from "cheerio";

const BASE = "https://www.londonboxoffice.co.uk";
const LIST_TTL_MS = 6 * 60 * 60 * 1000;
const CAL_TTL_MS = 60 * 60 * 1000;
const MAX_FALLBACK_SHOWS = 15;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

let listCache = null;
const calCache = new Map();

function decodeEntities(s) {
  return String(s || "")
    .replace(/&#0*39;/g, "'").replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function collectEvents(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(n => collectEvents(n, out)); return; }
  if (typeof node !== "object") return;
  if (node["@graph"]) collectEvents(node["@graph"], out);
  const type = String(node["@type"] || "");
  if (/Event/.test(type) && node.name) out.push(node);
}

// Returns [{name, showUrl, slug}] for every musical on LBO's /musicals page.
export function parseMusicalsList(html) {
  const $ = cheerio.load(html);
  const events = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    try { collectEvents(JSON.parse($(s).text()), events); } catch { /* ignore bad blocks */ }
  });
  const byUrl = new Map();
  for (const e of events) {
    const url = String(e.workPerformed?.sameAs || e.url || "");
    const m = url.match(/^https:\/\/www\.londonboxoffice\.co\.uk\/([a-z0-9-]+-tickets)\/?$/);
    if (!m) continue;
    const name = decodeEntities(e.workPerformed?.name || e.name).trim();
    if (name && !byUrl.has(m[1])) byUrl.set(m[1], { name, showUrl: `${BASE}/${m[1]}`, slug: m[1] });
  }
  return [...byUrl.values()];
}

// Returns {venue, days: {"YYYY-MM-DD": ["HH:MM", ...]}} for one month page.
export function parseMonthCalendar(html, year, month) {
  // Space before every tag so adjacent cells never run together ("£87.002 October").
  const $ = cheerio.load(String(html || "").replace(/</g, " <"));
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ");
  let venue = "";
  const vm = text.match(/Playing at:\s*(.*?)\s*(?:When\b|Booking until:|Tickets\b|$)/i);
  if (vm) venue = vm[1].trim();

  const monthName = MONTHS[month - 1];
  const cell = new RegExp(`\\b(\\d{1,2}) ${monthName}(?![a-z])(.*?)(?=\\b\\d{1,2} ${monthName}(?![a-z])|$)`, "g");
  const days = {};
  let m;
  while ((m = cell.exec(text))) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    const body = m[2];
    if (/No online availability/i.test(body)) continue;
    // Only times that are followed by a price are performances.
    const times = [];
    const tr = /\b([01]?\d|2[0-3]):([0-5]\d)\s*From\b/gi;
    let t;
    while ((t = tr.exec(body))) {
      const hhmm = `${String(t[1]).padStart(2, "0")}:${t[2]}`;
      if (!times.includes(hhmm)) times.push(hhmm);
    }
    if (!times.length) continue;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    days[date] = times;
  }
  return { venue, days };
}

async function getMusicalsList(fetchText) {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.data;
  const data = parseMusicalsList(await fetchText(`${BASE}/musicals`));
  listCache = { at: Date.now(), data };
  return data;
}

async function getMonth(fetchText, slug, year, month) {
  const key = `${slug}|${year}-${month}`;
  const hit = calCache.get(key);
  if (hit && Date.now() - hit.at < CAL_TTL_MS) return hit.data;
  const url = `${BASE}/search/month/${slug}/${year}/${String(month).padStart(2, "0")}/01/2`;
  const html = await fetchText(url);
  const data = { ...parseMonthCalendar(html, year, month), url, htmlLength: html.length, sample: cheerio.load(String(html).replace(/</g, " <"))("body").text().replace(/\s+/g, " ").match(/.{0,120}\b1 [A-Z][a-z]+ .{0,240}/)?.[0] || "" };
  calCache.set(key, { at: Date.now(), data });
  return data;
}

// dates: ISO strings of the trip. isFound(name): true if the day pages
// already produced this show. Returns
// {shows: [...], performances: {date: [[name, time], ...]}}.
export async function findMissingPerformances({ dates, isFound, fetchText }) {
  const debug = { listCount: 0, listNames: [], missing: [], calendars: {}, errors: [] };
  const result = { shows: [], performances: {}, debug };
  let list;
  try { list = await getMusicalsList(fetchText); } catch (err) {
    console.error("LBO musicals list failed:", err?.message || err);
    debug.errors.push(`list: ${err?.message || err}`);
    return result;
  }
  debug.listCount = list.length;
  debug.listNames = list.map(s => s.name);
  const missing = list.filter(s => !isFound(s.name)).slice(0, MAX_FALLBACK_SHOWS);
  debug.missing = missing.map(s => s.slug);
  const months = [...new Set(dates.map(d => d.slice(0, 7)))].map(ym => ym.split("-").map(Number));
  const wanted = new Set(dates);

  async function readShow(show) {
    let venue = "";
    let firstUrl = "";
    const perfs = [];
    for (const [y, mo] of months) {
      let cal;
      try { cal = await getMonth(fetchText, show.slug, y, mo); } catch (err) {
        console.error(`LBO calendar failed for ${show.slug}:`, err?.message || err);
        debug.errors.push(`${show.slug} ${y}-${mo}: ${err?.message || err}`);
        continue;
      }
      debug.calendars[`${show.slug} ${y}-${mo}`] = { days: Object.keys(cal.days).length, venue: cal.venue, htmlLength: cal.htmlLength, sample: Object.keys(cal.days).length ? "" : cal.sample };
      venue = venue || cal.venue;
      for (const [date, times] of Object.entries(cal.days)) {
        if (!wanted.has(date)) continue;
        if (!firstUrl) firstUrl = cal.url;
        times.forEach(time => perfs.push([date, time]));
      }
    }
    return { show, venue, firstUrl, perfs };
  }

  const read = [];
  for (let i = 0; i < missing.length; i += 5) read.push(...await Promise.all(missing.slice(i, i + 5).map(readShow)));
  for (const { show, venue, firstUrl, perfs } of read) {
    if (!perfs.length) continue;
    result.shows.push({ name: show.name, venue: venue || "London", ticketUrl: firstUrl || show.showUrl, infoUrl: show.showUrl });
    for (const [date, time] of perfs) (result.performances[date] ||= []).push([show.name, time]);
  }
  return result;
}
