import * as cheerio from "cheerio";

// Resolves the SeatPlan ticket page for a musical so the planner's "ticket website"
// link always points at SeatPlan (London: seatplan.com/london/..., Broadway: seatplan.com/new-york/...).
// The listing page is scraped once per city and cached; if the fetch fails or a show
// cannot be matched, the link falls back to the SeatPlan city listing page.
//
// GET /api/seatplan?city=london|broadway returns the parsed show list (debug aid).

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

function normalizeAlt(value){return String(value||"").toLowerCase().replace(/[^a-z0-9]+/g,"")}
function pickImage($,el){
  const img=$(el).find("img").first();
  if(!img.length)return "";
  const raw=img.attr("data-src")||img.attr("data-lazy-src")||img.attr("src")||"";
  if(raw)return raw;
  const srcset=img.attr("data-srcset")||img.attr("srcset")||"";
  return srcset.split(",")[0].trim().split(/\s+/)[0]||"";
}
function pickDescription($,el,title){
  const norm=normalizeAlt(title);
  const skip=t=>!t||t.length<35||t.length>500||normalizeAlt(t)===norm||/^(from|save up to|opens|theatre week)/i.test(t)||/^[\d.]+$/.test(t);
  const candidates=[];
  $(el).find("p, div, span").each((_,node)=>{
    if($(node).children().length&&$(node).find("p, div, span").length)return;
    const t=$(node).text().replace(/\s+/g," ").trim();
    if(!skip(t))candidates.push(t);
  });
  if(candidates.length)return candidates[0];
  const whole=$(el).text().replace(/\s+/g," ").trim().replace(title,"").trim();
  const sentence=whole.match(/[A-Z][^.!?]{30,400}[.!?]/);
  return sentence?sentence[0].trim():"";
}
function cardFor($,a,title){
  const norm=normalizeAlt(title);
  let node=$(a).parent();
  for(let i=0;i<8&&node.length&&!node.is("body");i++){
    const imgs=node.find("img");
    if(imgs.length){
      const altMatch=imgs.filter((_,img)=>normalizeAlt($(img).attr("alt"))===norm).length>0;
      if(altMatch||imgs.length===1)return node;
    }
    node=node.parent();
  }
  return null;
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
    const card = cardFor($, a, text);
    let image = "";
    let description = "";
    if (card) {
      try { image = new URL(pickImage($, card) || "", config.base).href; } catch { image = ""; }
      if (!/^https?:/.test(image) || !/\.(webp|jpe?g|png|avif)(\?|$)/i.test(image)) image = "";
      description = pickDescription($, card, text);
    }
    const prev = byHref.get(href);
    if (!prev || text.length > prev.name.length) byHref.set(href, { name: text, href, image: image || prev?.image || "", description: description || prev?.description || "" });
    else { if (!prev.image && image) prev.image = image; if (!prev.description && description) prev.description = description; }
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

export function matchSeatPlanShow(city, showName, shows) {
  const wanted = normalizeName(showName);
  if (!wanted) return null;

  let best = null;
  for (const show of shows) {
    const candidate = normalizeName(show.name);
    if (!candidate) continue;
    if (candidate === wanted) return show;
    if (candidate.length >= 5 && wanted.length >= 5 && (candidate.includes(wanted) || wanted.includes(candidate))) {
      const score = Math.min(candidate.length, wanted.length) / Math.max(candidate.length, wanted.length);
      if (!best || score > best.score) best = { show, score };
    }
  }
  if (best && best.score >= 0.6) return best.show;
  return null;
}

export function matchSeatPlanUrl(city, showName, shows) {
  const match = matchSeatPlanShow(city, showName, shows);
  return match ? match.href : seatPlanFallbackUrl(city);
}

// Rewrites ticketUrl on every show to its SeatPlan page and attaches image/description. Never throws.
export async function applySeatPlanLinks(city, showList) {
  let shows = [];
  try { shows = await loadSeatPlanShows(city); } catch { shows = []; }
  for (const show of showList) {
    show.sourceTicketUrl = show.ticketUrl || "";
    const match = matchSeatPlanShow(city, show.name, shows);
    show.ticketUrl = match ? match.href : seatPlanFallbackUrl(city);
    // Poster/logo image and one-line plot summary for the hover tooltip in the planner.
    show.image = match?.image || "";
    show.description = match?.description || "";
    show.infoSource = match && (match.image || match.description) ? "SeatPlan" : "";
  }
  return showList;
}

// Fallback for shows SeatPlan does not list: read Open Graph image/description from the
// show's own info page (londontheatre.co.uk / broadway.com). Cached per URL, never throws.
const INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const infoCache = new Map();

function firstMeta($, names) {
  for (const name of names) {
    const v = $(`meta[property="${name}"]`).attr("content") || $(`meta[name="${name}"]`).attr("content") || "";
    if (v && v.trim()) return v.trim();
  }
  return "";
}

async function fetchShowInfo(url) {
  if (!url || !/^https?:/.test(url)) return { image: "", description: "" };
  const cached = infoCache.get(url);
  if (cached && Date.now() - cached.at < INFO_CACHE_TTL_MS) return cached.info;
  let info = { image: "", description: "" };
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    let image = firstMeta($, ["og:image", "og:image:secure_url", "twitter:image"]);
    try { image = image ? new URL(image, url).href : ""; } catch { image = ""; }
    let description = firstMeta($, ["og:description", "description", "twitter:description"]);
    description = description.replace(/\s+/g, " ").trim();
    // Generic marketing boilerplate ("Book tickets for X ...") is not a synopsis.
    if (/^(book|buy|get|find|official)\b.*\btickets?\b/i.test(description) && description.length < 90) description = "";
    if (description.length > 400) description = description.slice(0, 397).replace(/\s+\S*$/, "") + "…";
    info = { image, description };
  } catch (err) {
    console.error("Show info fetch failed:", url, String(err?.message || err));
  }
  infoCache.set(url, { at: Date.now(), info });
  return info;
}

export async function enrichMissingShowInfo(showList, sourceLabel) {
  const missing = showList.filter(show => (!show.image || !show.description) && show.infoUrl);
  const limit = 4;
  let next = 0;
  async function worker() {
    while (next < missing.length) {
      const show = missing[next++];
      const info = await fetchShowInfo(show.infoUrl);
      if (!show.image && info.image) show.image = info.image;
      if (!show.description && info.description) show.description = info.description;
      if ((info.image || info.description) && !show.infoSource) show.infoSource = sourceLabel;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, missing.length) }, worker));
  return showList;
}

export default async function handler(req, res) {
  const city = String(req.query?.city || "london").toLowerCase();
  const shows = await loadSeatPlanShows(city);
  res.status(200);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.end(JSON.stringify({ city, count: shows.length, shows }));
}
