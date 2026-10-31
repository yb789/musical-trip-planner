import { CITIES, renderShow, renderCity, renderMatinees, renderGuide, renderGuidesIndex, renderAbout, renderPrivacy, notFound } from "../lib/site-pages.js";
import { loadSchedule } from "../lib/schedule-data.js";
import { handleGo } from "../lib/go.js";

// Indexable pages, reached through vercel.json rewrites:
//   /london/  /new-york/            -> ?type=city&city=…
//   /london/matinees/ /new-york/matinees/ -> ?type=matinees&city=…
//   /london/:slug/  /new-york/:slug/ -> ?type=show&city=…&slug=…
//   /guides/  /guides/:slug/         -> ?type=guide&slug=…
//   /about/                          -> ?type=about
//   /go?u=…&subId1=…                 -> ?type=go  (ticket redirect, lib/go.js)
export default async function handler(req, res) {
  const q = req.query || {};
  const type = String(q.type || "");
  if (type === "go") return handleGo(req, res);
  const city = String(q.city || "");
  const slug = String(q.slug || "").toLowerCase().replace(/\/+$/, "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    let html = null;
    let cache = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
    if (type === "city" && CITIES[city]) html = renderCity(city);
    else if (type === "matinees" && CITIES[city]) {
      // Live planner schedule for the next 7 days. Cached for 12 hours at the edge and served stale
      // for up to a week while it refreshes, so visitors rarely wait for the scrape.
      try {
        html = renderMatinees(city, await loadSchedule(city, new Date()));
        cache = "public, max-age=600, s-maxage=43200, stale-while-revalidate=604800";
      } catch (err) {
        console.error("matinees page failed", city, err?.message || err);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Retry-After", "600");
        return res.status(503).send('<!doctype html><meta charset=utf-8><title>Temporarily unavailable</title><p style="font-family:sans-serif;padding:24px">The live schedule could not be read right now. Please try again in a few minutes, or <a href="/#/plan">open the planner</a>.</p>');
      }
    }
    else if (type === "show" && CITIES[city] && /^[a-z0-9-]{1,80}$/.test(slug)) {
      const meta = {};
      const check = q.check === "1";
      html = await renderShow(city, slug, { meta, check });
      // Cache pages with live times for 6 hours; retry sooner if Ticketmaster was unavailable.
      // ?check=1 shows Ticketmaster diagnostics and is never cached or indexed.
      cache = check ? "no-store" : meta.tmOk ? "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400" : "public, max-age=60, s-maxage=600";
      if (check) res.setHeader("X-Robots-Tag", "noindex");
    }
    else if (type === "about") html = renderAbout();
    else if (type === "privacy") html = renderPrivacy();
    else if (type === "guide" && !slug) html = renderGuidesIndex();
    else if (type === "guide" && /^[a-z0-9-]{1,80}$/.test(slug)) html = renderGuide(slug);
    if (!html) {
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=600");
      return res.status(404).send(notFound());
    }
    res.setHeader("Cache-Control", cache);
    res.status(200).send(html);
  } catch (err) {
    console.error("page render failed", type, city, slug, err);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send('<!doctype html><meta charset=utf-8><title>Temporarily unavailable</title><p style="font-family:sans-serif;padding:24px">This page is temporarily unavailable. <a href="/">Open the planner</a></p>');
  }
}
