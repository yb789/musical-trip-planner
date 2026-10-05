import * as cheerio from "cheerio";

// Resolves the SeatPlan ticket page for a musical so the planner's "ticket website"
// link always points at SeatPlan (London: seatplan.com/london/..., Broadway: seatplan.com/new-york/...).
// The listing page is scraped once per city and cached; if the fetch fails or a show
// cannot be matched, the link falls back to the SeatPlan city listing page.
//
// Internal helper only (lib/, so Vercel does not publish it as an endpoint). Used by
// api/schedule.js and api/broadway2.js; the SeatPlan listing is never served to visitors.

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

const CITY_CONFIG = {
  london: {
    base: "https://seatplan.com/london/",
    listings: [
      "https://seatplan.com/london/whats-on/musicals/",
      "https://seatplan.com/london/"
    ],
    pathPrefix: "/london/"
  },
  broadway: {
    base: "https://seatplan.com/new-york/",
    listings: [
      "https://seatplan.com/new-york/whats-on/musicals/",
      "https://seatplan.com/new-york/"
    ],
    pathPrefix: "/new-york/"
  }
};

function normalizeName(value) {
  let s = String(value || "").toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/&/g, " and ");
  // Broadway.com price fragments and SeatPlan location suffixes.
  s = s.replace(/\s+from\s+(?:us)?\$[\d,.]+.*$/i, "");
  s = s.replace(/\s+save(?:\s+up\s+to)?\s+(?:us)?\$[\d,.]+.*$/i, "");
  s = s.replace(/\b(on broadway|broadway|west end|london|new york|off broadway)\b/g, " ");
  s = s.replace(/\b(the musical|a new musical|musical|the show|tickets?)\b/g, " ");
  s = s.replace(/\b(the|a|an)\b/g, " ");
  s = s.replace(/[^a-z0-9]+/g, "");
  return s.trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9"
      },
      redirect: "follow",
      signal: controller.signal
    });
    if (!r.ok) throw new Error(`${r.status} from seatplan.com`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseListing(html, config) {
  const $ = cheerio.load(html);
  const byHref = new Map();
  $("a[href*='-tickets']").each((_, a) => {
    let href = $(a).attr("href") || "";
    try { href = new URL(href, config.base).href; } catch { return; }
    const path = new URL(href).pathname;
    if (!path.startsWith(config.pathPrefix)) return;
    if (!/^\/[a-z-]+\/[^/]+-tickets\/?$/.test(path)) return;
    const text = $(a).text().replace(/\s+/g, " ").trim();
    if (!text || text.length > 120) return;
    if (!href.endsWith("/")) href += "/";
    // Only the show name and its SeatPlan page URL are kept. Images and synopses are
    // SeatPlan content and are not reproduced on our site (SeatPlan terms).
    const prev = byHref.get(href);
    if (!prev || text.length > prev.name.length) byHref.set(href, { name: text, href });
  });
  return [...byHref.values()];
}

export async function loadSeatPlanShows(city) {
  const config = CITY_CONFIG[city];
  if (!config) return [];
  const cached = cache.get(city);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.shows;

  const merged = new Map();
  for (const url of config.listings) {
    try {
      const html = await fetchText(url);
      for (const show of parseListing(html, config)) merged.set(show.href, show);
    } catch (err) {
      console.error("SeatPlan listing failed:", url, String(err?.message || err));
    }
  }
  const shows = [...merged.values()];
  if (shows.length) cache.set(city, { at: Date.now(), shows });
  return shows;
}

// Musicals listing only (no plays), used by the weekly guide check to spot shows missing
// from our guide. Names are compared internally and never shown on the site. Not cached.
export async function loadSeatPlanMusicals(city) {
  const config = CITY_CONFIG[city];
  if (!config) return [];
  const html = await fetchText(config.listings[0]);
  return parseListing(html, config);
}

export function seatPlanFallbackUrl(city) {
  return (CITY_CONFIG[city] || CITY_CONFIG.london).base;
}

function editDistance(a, b) {
  const rows = a.length + 1, cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[cols - 1];
}

// Scores how well a scraped title matches a SeatPlan title (both already normalized).
// 1 = identical; prefix matches ("shamilton" vs "shamiltonimprovisedhiphop") score high because
// listing sites often append a subtitle; small typos are tolerated via edit distance.
function nameScore(wanted, candidate) {
  if (candidate === wanted) return 1;
  const shorter = wanted.length <= candidate.length ? wanted : candidate;
  const longer = shorter === wanted ? candidate : wanted;
  if (shorter.length >= 6 && longer.startsWith(shorter)) return 0.9;
  if (shorter.length >= 5 && longer.includes(shorter)) return 0.5 + 0.4 * (shorter.length / longer.length);
  if (shorter.length >= 8) {
    const d = editDistance(wanted, candidate);
    if (d <= 2) return 0.85 - 0.1 * d;
  }
  return 0;
}

export function matchSeatPlanShow(city, showName, shows) {
  const wanted = normalizeName(showName);
  if (!wanted) return null;

  let best = null;
  for (const show of shows) {
    const candidate = normalizeName(show.name);
    if (!candidate) continue;
    const score = nameScore(wanted, candidate);
    if (score === 1) return show;
    if (score > 0 && (!best || score > best.score)) best = { show, score };
  }
  if (best && best.score >= 0.6) return best.show;
  return null;
}

export function matchSeatPlanUrl(city, showName, shows) {
  const match = matchSeatPlanShow(city, showName, shows);
  return match ? match.href : seatPlanFallbackUrl(city);
}

// Rewrites ticketUrl on every show to its SeatPlan page. Never throws.
// Only the link is used: no images or descriptions are taken from SeatPlan or other listing sites.
export async function applySeatPlanLinks(city, showList) {
  let shows = [];
  try { shows = await loadSeatPlanShows(city); } catch { shows = []; }
  for (const show of showList) {
    show.sourceTicketUrl = show.ticketUrl || "";
    const match = matchSeatPlanShow(city, show.name, shows);
    show.ticketUrl = match ? match.href : seatPlanFallbackUrl(city);
  }
  return showList;
}
