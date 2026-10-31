// GET /go?u=<seller page>&subId1=<where the click came from>   (rewrite in vercel.json)
// Redirects to the Impact affiliate link for that seller page. Only Ticketmaster UK/US and SeatPlan
// pages are accepted (sellerOf), so this can never send anyone to another site; the subId is
// limited to [a-z0-9-]. robots.txt disallows /go, so well-behaved crawlers stop here and no longer
// inflate Impact's click counts. Each hit is counted in our events table: go_click for browsers,
// go_bot when the user agent looks automated (those still get redirected).
import { affiliateUrl, sellerOf, SUBID_RE } from "../lib/site-pages.js";
import { storeEvent } from "../lib/events.js";

const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|scan|check|monitor|headless|python|curl|wget|httpclient|java\/|go-http|axios|node-fetch|undici|facebookexternalhit|whatsapp|telegram|discord|slack|skype|embedly|bingpreview/i;
export const isBot = ua => !ua || BOT_RE.test(ua);

export function resolve(query) {
  const u = typeof query?.u === "string" ? query.u.slice(0, 1000) : "";
  const seller = sellerOf(u);
  if (!seller) return null;
  const raw = typeof query?.subId1 === "string" ? query.subId1.toLowerCase() : "";
  const subId = SUBID_RE.test(raw) ? raw : "";
  return { seller, subId, target: affiliateUrl(u, subId) };
}

const cityOf = u => (/ticketmaster\.co\.uk|seatplan\.com\/london/i.test(u) ? "london" : /ticketmaster\.com|seatplan\.com\/new-york/i.test(u) ? "broadway" : "");

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); return res.status(405).end(); }
  const r = resolve(req.query || {});
  if (!r) {
    res.status(400);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end('<!doctype html><meta charset="utf-8"><title>Link not recognised</title><p>This ticket link is not recognised. <a href="/">Back to Musical Trip Planner</a></p>');
  }
  if (req.method === "GET") {
    const ua = String(req.headers["user-agent"] || "");
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
    const ev = { event: isBot(ua) ? "go_bot" : "go_click", page: "/go", city: cityOf(String(req.query.u)), seller: r.seller, show: r.subId };
    // Count the click, but never hold the visitor up for more than ~0.4 s or fail the redirect.
    const stored = storeEvent(ev, ip).catch(err => console.error("go: event store failed", err));
    await Promise.race([stored, new Promise(ok => setTimeout(ok, 400))]);
  }
  res.statusCode = 302;
  res.setHeader("Location", r.target);
  return res.end();
}
