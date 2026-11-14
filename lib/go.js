// GET /go?u=<seller page>&subId1=<where the click came from>
// vercel.json rewrites /go to /api/pages?type=go, which calls handleGo (the Hobby plan allows only
// 12 serverless functions, so this lives inside api/pages.js rather than its own api/ file).
// Redirects to the Impact affiliate link for that seller page. Only Ticketmaster UK/US and SeatPlan
// pages are accepted (sellerOf), so this can never send anyone to another site; the subId is
// limited to [a-z0-9-]. robots.txt disallows /go, so well-behaved crawlers stop here and no longer
// inflate Impact's click counts. Each hit is counted in our events table: go_click for browsers,
// go_bot when the user agent looks automated (those still get redirected). A browser that opted out of
// the counter (?notrack=1, static/events.js) adds nt=1 to the link: still redirected, not counted.
import { affiliateUrl, sellerOf, SUBID_RE } from "./site-pages.js";
import { storeEvent, countryOf } from "./events.js";
import { failingSeatPlanShowPages, seatPlanShowPage } from "./link-check.js";

const BOT_RE = /bot|crawl|spider|slurp|preview|fetch|scan|check|monitor|headless|python|curl|wget|httpclient|java\/|go-http|axios|node-fetch|undici|facebookexternalhit|whatsapp|telegram|discord|slack|skype|embedly|bingpreview/i;
export const isBot = ua => !ua || BOT_RE.test(ua);

// 2026-11-13: crawlers with ordinary browser user agents were following the per-performance links on
// Broadway show pages (robots.txt says Disallow: /go): ~1,500 "clicks" in a month, each from a different
// IP, none of which had opened a page. Impact counted thousands of clicks for 1 sale. A person's click on
// a link makes the browser send Sec-Fetch-User: ?1 (Chrome, Edge, Firefox, Safari 16.4+, Android app);
// a crawler fetching the URL doesn't. Only those clicks are redirected straight away. Everything else gets
// a small "Continue to <seller>" page whose button POSTs back here, so a person can always go on, and a
// link-following crawler never reaches the seller or Impact.
export const isPersonClick = headers => String(headers?.["sec-fetch-user"] || "") === "?1";
const SELLER_NAME = { ticketmaster: "Ticketmaster", seatplan: "SeatPlan" };
const escHtml = v => String(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function continuePage(seller, action) {
  const name = SELLER_NAME[seller] || "the ticket seller";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Continue to ${escHtml(name)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f1e8;color:#181818;margin:0;padding:48px 16px;text-align:center}main{max-width:440px;margin:0 auto;background:#fffdf8;border:1px solid #ddd6ca;border-radius:16px;padding:24px}button{min-height:48px;padding:12px 22px;border-radius:12px;border:0;background:#1f4b3f;color:#fff;font-size:17px;font-weight:600;cursor:pointer}p{color:#6b665f}</style></head>
<body><main><h1 style="font:700 22px/1.3 Georgia,serif;margin:0 0 12px">Continue to ${escHtml(name)}</h1><p>You're leaving Musical Trip Planner to see tickets.</p>
<form method="post" action="${escHtml(action)}"><button type="submit">Continue to ${escHtml(name)} →</button></form>
<p style="font-size:14px;margin-top:18px"><a href="/">Back to Musical Trip Planner</a></p></main></body></html>`;
}

// Answer to the continue page's button: sends the browser to the seller with a meta refresh and a script,
// plus a plain link in case both are switched off.
export function onwardPage(seller, target) {
  const name = SELLER_NAME[seller] || "the ticket seller";
  const t = escHtml(target);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="refresh" content="0;url=${t}"><title>Opening ${escHtml(name)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f5f1e8;color:#181818;margin:0;padding:48px 16px;text-align:center}a{color:#1f4b3f;font-weight:600}</style></head>
<body><p>Opening ${escHtml(name)}…</p><p><a id="on" rel="nofollow sponsored" href="${t}">Tap here if nothing happens</a></p>
<script>location.replace(document.getElementById("on").href)</script></body></html>`;
}

// 2026-11-10: a SeatPlan date link (…/x-tickets/tickets/14-nov-2026/7-30pm/) whose show failed the
// nightly link check (lib/link-check.js) goes to that show's SeatPlan page instead, so visitors never
// land on a wrong or general page. Waits at most 300 ms for the list; without it the link is kept.
export async function safeSeatPlanUrl(u, badPagesImpl = failingSeatPlanShowPages) {
  const showPage = seatPlanShowPage(u);
  if (!showPage) return u;
  const bad = await Promise.race([badPagesImpl().catch(() => null), new Promise(ok => setTimeout(() => ok(null), 300))]);
  return bad && bad.has(showPage) ? showPage : u;
}

export function resolve(query) {
  const u = typeof query?.u === "string" ? query.u.slice(0, 1000) : "";
  const seller = sellerOf(u);
  if (!seller) return null;
  const raw = typeof query?.subId1 === "string" ? query.subId1.toLowerCase() : "";
  const subId = SUBID_RE.test(raw) ? raw : "";
  return { seller, subId, target: affiliateUrl(u, subId) };
}

const cityOf = u => (/ticketmaster\.co\.uk|seatplan\.com\/london/i.test(u) ? "london" : /ticketmaster\.com|seatplan\.com\/new-york/i.test(u) ? "broadway" : "");

export async function handleGo(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") { res.setHeader("Allow", "GET, HEAD, POST"); return res.status(405).end(); }
  let r = resolve(req.query || {});
  if (r && r.seller === "seatplan") {
    const safe = await safeSeatPlanUrl(String(req.query.u).slice(0, 1000));
    if (safe !== String(req.query.u).slice(0, 1000)) r = resolve({ ...req.query, u: safe });
  }
  if (!r) {
    res.status(400);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end('<!doctype html><meta charset="utf-8"><title>Link not recognised</title><p>This ticket link is not recognised. <a href="/">Back to Musical Trip Planner</a></p>');
  }
  const ua = String(req.headers["user-agent"] || "");
  // POST = the button on the continue page; GET with Sec-Fetch-User = a person's click on our link.
  const person = !isBot(ua) && (req.method === "POST" || isPersonClick(req.headers));
  if (req.method !== "HEAD" && String(req.query?.nt || "") !== "1") {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
    const ev = { event: person ? "go_click" : "go_bot", page: "/go", city: cityOf(String(req.query.u)), seller: r.seller, show: r.subId };
    // Count the click, but never hold the visitor up for more than ~0.4 s or fail the redirect.
    const stored = storeEvent(ev, ip, countryOf(req.headers)).catch(err => console.error("go: event store failed", err));
    await Promise.race([stored, new Promise(ok => setTimeout(ok, 400))]);
  }
  if (!person) {
    // Same URL as this request, so the button's POST carries u / subId1 / nt unchanged.
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(req.method === "HEAD" ? "" : continuePage(r.seller, String(req.url || "/go")));
  }
  if (req.method === "POST") {
    // 2026-11-14: the site's Content-Security-Policy says form-action 'self', and Safari and Chrome apply
    // that to redirects after a form is sent too. A 303 to the seller was therefore blocked and the button
    // did nothing. The button's POST now gets a page that moves the browser on by itself (not a redirect).
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(onwardPage(r.seller, r.target));
  }
  res.statusCode = 303;
  res.setHeader("Location", r.target);
  return res.end();
}
