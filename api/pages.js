import { CITIES, renderShow, renderCity, renderGuide, renderGuidesIndex, notFound } from "../lib/site-pages.js";

// Indexable pages, reached through vercel.json rewrites:
//   /london/  /new-york/            -> ?type=city&city=…
//   /london/:slug/  /new-york/:slug/ -> ?type=show&city=…&slug=…
//   /guides/  /guides/:slug/         -> ?type=guide&slug=…
export default async function handler(req, res) {
  const q = req.query || {};
  const type = String(q.type || "");
  const city = String(q.city || "");
  const slug = String(q.slug || "").toLowerCase().replace(/\/+$/, "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    let html = null;
    let cache = "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";
    if (type === "city" && CITIES[city]) html = renderCity(city);
    else if (type === "show" && CITIES[city] && /^[a-z0-9-]{1,80}$/.test(slug)) {
      const meta = {};
      html = await renderShow(city, slug, { meta });
      // Cache pages with live times for 6 hours; retry sooner if Ticketmaster was unavailable.
      cache = meta.tmOk ? "public, max-age=300, s-maxage=21600, stale-while-revalidate=86400" : "public, max-age=60, s-maxage=600";
    }
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
