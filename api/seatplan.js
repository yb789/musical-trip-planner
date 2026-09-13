import * as cheerio from "cheerio";

// Resolves the SeatPlan ticket page for a musical so the planner's "ticket website"
// link always points at SeatPlan (London: seatplan.com/london/..., Broadway: seatplan.com/new-york/...).
// The listing page is scraped once per city and cached; if the fetch fails or a show
// cannot be matched, the link falls back to the SeatPlan city listing page.

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
  let s = String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
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

export function seatPlanFallbackUrl(city) {
  return (CITY_CONFIG[city] || CITY_CONFIG.london).base;
}

export function matchSeatPlanUrl(city, showName, shows) {
  const wanted = normalizeName(showName);
  if (!wanted) return seatPlanFallbackUrl(city);

  let best = null;
  for (const show of shows) {
    const candidate = normalizeName(show.name);
    if (!candidate) continue;
    if (candidate === wanted) return show.href;
    if (candidate.length >= 5 && wanted.length >= 5 && (candidate.includes(wanted) || wanted.includes(candidate))) {
      const score = Math.min(candidate.length, wanted.length) / Math.max(candidate.length, wanted.length);
      if (!best || score > best.score) best = { href: show.href, score };
    }
  }
  if (best && best.score >= 0.6) return best.href;
  return seatPlanFallbackUrl(city);
}

// Rewrites ticketUrl on every show to its SeatPlan page. Never throws.
export async function applySeatPlanLinks(city, showList) {
  let shows = [];
  try { shows = await loadSeatPlanShows(city); } catch { shows = []; }
  for (const show of showList) {
    show.sourceTicketUrl = show.ticketUrl || "";
    show.ticketUrl = matchSeatPlanUrl(city, show.name, shows);
  }
  return showList;
}
