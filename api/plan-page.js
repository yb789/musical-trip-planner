import { SITE, loadPlan, isValidCode, cityLabel, fmtDay, rangeLabel, planStats, planTitle } from "../lib/plans.js";
import { guideEntryFor } from "../lib/site-pages.js";

const KIND_LABEL = { play: "Play", spectacular: "Spectacular", family: "Family show" };
const CITY_SLUG = { london: "london", broadway: "new-york" };

// Read-only page for a shared itinerary. Reached through the vercel.json rewrite  /plan/:code -> /api/plan-page?code=:code
// Server-rendered so WhatsApp / iMessage / Facebook see per-plan Open Graph tags and a per-plan image (/api/og?plan=CODE).

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CSS = `
:root{--bg:#f5f1e8;--paper:#fffdf8;--ink:#181818;--muted:#6b665f;--line:#ddd6ca;--accent:#7c2d12;--green:#1f4b3f;--gold:#d6a860}
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--accent)}
:root{--kind-play:#4f46a0;--kind-spectacular:#b4560d;--kind-family:#1f7a4d}.kind-pill{display:inline-block;margin-left:4px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;vertical-align:middle;color:#fff}.kind-pill[data-kind=play]{background:var(--kind-play)}.kind-pill[data-kind=spectacular]{background:var(--kind-spectacular)}.kind-pill[data-kind=family]{background:var(--kind-family)}.perf[data-kind=play]{box-shadow:inset 4px 0 0 var(--kind-play)}.perf[data-kind=spectacular]{box-shadow:inset 4px 0 0 var(--kind-spectacular)}.perf[data-kind=family]{box-shadow:inset 4px 0 0 var(--kind-family)}.perf .part{font-size:12px;font-weight:600;color:var(--muted)}.parts-note{font-size:12px;line-height:1.4;color:#73520b;background:#fff2d9;border:1px solid #e5c681;border-radius:8px;padding:5px 8px;margin-top:6px}
header{background:linear-gradient(135deg,#17130f,#35251c);color:#fffdf8;padding:28px 16px 30px}
header .wrap{max-width:760px;margin:0 auto}
header .brand{font:700 15px/1 Georgia,serif;color:var(--gold);letter-spacing:.04em;text-decoration:none}
header h1{font:700 clamp(26px,5vw,40px)/1.15 Georgia,serif;margin:14px 0 8px}
header p{margin:0;color:#eadfd5;font-size:15px}
main{max-width:760px;margin:0 auto;padding:18px 16px 60px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 18px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:12px;border:1px solid var(--line);background:#fffaf2;color:var(--ink);font-weight:600;text-decoration:none;font-size:15px}
.btn.primary{background:var(--green);border-color:var(--green);color:#fff}
.day{background:var(--paper);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 35px rgba(30,25,20,.06);margin:0 0 12px;overflow:hidden}
.day h2{margin:0;padding:12px 16px;font-size:15px;background:#f8f3ea;border-bottom:1px solid var(--line)}
.perf{display:grid;grid-template-columns:34px 1fr;gap:6px 10px;padding:12px 16px;border-top:1px solid var(--line)}
.perf:first-of-type{border-top:0}
.perf .icon{font-size:22px;line-height:1.2}
.perf b{font-size:17px}
.perf .meta{color:var(--muted);font-size:14px;line-height:1.45}
.perf .links{margin-top:4px;font-size:14px}
.perf .links a{margin-right:14px}
.note{color:var(--muted);font-size:13px;margin:22px 0 0;line-height:1.5}
footer{text-align:center;color:var(--muted);font-size:13px;padding:0 16px 30px}
`;

function page({ title, description, code, body, status = 200, noindex = true }) {
  const url = `${SITE}/plan/${code}`;
  const image = `${SITE}/api/og?plan=${encodeURIComponent(code)}`;
  return { status, html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Musical Trip Planner</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${esc(url)}"><meta name="theme-color" content="#17130f">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/api/og?icon=180">
<meta property="og:type" content="website"><meta property="og:site_name" content="Musical Trip Planner">
<meta property="og:url" content="${esc(url)}"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="${esc(image)}">
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>
<script defer src="/_vercel/insights/script.js"></script>
<script defer src="/events.js"></script>
<style>${CSS}</style></head>
<body>${body}
<footer>Free planner for West End and Broadway trips · <a href="/">musicaltripplanner.com</a></footer>
</body></html>` };
}

export function renderPlan(code, plan) {
  const { shows, days } = planStats(plan);
  const title = planTitle(plan);
  const description = `${shows} chosen performance${shows === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"} in ${cityLabel(plan.city)}. Open it in Musical Trip Planner to edit or make your own.`;
  const dates = Object.keys(plan.choices).sort();
  const dayHtml = dates.map(d => {
    const perfs = ["matinee", "evening"].map(sess => {
      const c = plan.choices[d][sess];
      if (!c) return "";
      const links = [
        c.ticketUrl ? `<a href="${esc(c.ticketUrl)}" target="_blank" rel="noopener sponsored">Tickets ↗</a>` : "",
        (c.venueUrl || c.infoUrl) ? `<a href="${esc(c.venueUrl || c.infoUrl)}" target="_blank" rel="noopener">Theatre ↗</a>` : ""
      ].filter(Boolean).join("");
      const g = guideEntryFor(CITY_SLUG[plan.city] || "london", c.name);
      const kind = (g && g.kind) || c.kind || "musical";
      const pill = KIND_LABEL[kind] ? ` <span class="kind-pill" data-kind="${kind}">${KIND_LABEL[kind]}</span>` : "";
      const part = g && g.parts === 2 ? (sess === "matinee" ? "Part One" : (new Date(d + "T12:00:00Z").getUTCDay() === 4 ? "Part One" : "Part Two")) : "";
      const partsNote = g && g.parts === 2 ? `<div class="parts-note">${esc(g.partsNote || "Two-part play: Part One and Part Two are separate tickets; you need both to see the whole story.")}</div>` : "";
      return `<div class="perf" data-kind="${kind}"><div class="icon">${sess === "matinee" ? "☀️" : "🌙"}</div><div>
<b>${esc(c.name)}</b>${pill}${part ? ` <span class="part">${part}</span>` : ""}${partsNote}
<div class="meta">${esc(sess === "matinee" ? "Matinee" : "Evening")}${c.time ? " · " + esc(c.time) : ""}${c.venue ? "<br>🎭 " + esc(c.venue) : ""}${c.address ? "<br>📍 " + esc(c.address) : ""}</div>
${links ? `<div class="links">${links}</div>` : ""}</div></div>`;
    }).join("");
    return `<section class="day"><h2>${esc(fmtDay(d, { year: true }))}</h2>${perfs}</section>`;
  }).join("");
  const body = `<header><div class="wrap"><a class="brand" href="/">MUSICAL TRIP PLANNER</a>
<h1>${esc(title)}</h1><p>${esc(cityLabel(plan.city))} · ${shows} performance${shows === 1 ? "" : "s"} over ${days} day${days === 1 ? "" : "s"}${plan.title ? " · " + esc(plan.title) : ""}</p></div></header>
<main>
<div class="cta"><a class="btn primary" href="/?plan=${esc(code)}">Open in planner</a><a class="btn" href="/">Make your own plan</a></div>
${dayHtml}
<p class="note">Times and theatres were correct when this plan was shared; always check the ticket site before booking. Opening the plan in the planner copies it into your own browser, where you can change or export it.</p>
</main>`;
  return page({ title, description, code, body, noindex: true });
}

export function renderMissing(code) {
  const body = `<header><div class="wrap"><a class="brand" href="/">MUSICAL TRIP PLANNER</a><h1>Plan not found</h1><p>This link does not point to a saved plan. It may have been mistyped.</p></div></header>
<main><div class="cta"><a class="btn primary" href="/">Start a new plan</a></div></main>`;
  return page({ title: "Plan not found", description: "This shared plan does not exist.", code: code || "", body, status: 404 });
}

export default async function handler(req, res) {
  const code = String((req.query && req.query.code) || "").toLowerCase();
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  try {
    const found = isValidCode(code) ? await loadPlan(code, { countView: true }) : null;
    const out = found ? renderPlan(code, found.plan) : renderMissing(code);
    res.setHeader("Cache-Control", found ? "public, max-age=60, s-maxage=600, stale-while-revalidate=86400" : "no-store");
    res.status(out.status).send(out.html);
  } catch (err) {
    console.error("plan page failed", err);
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send("<!doctype html><meta charset=utf-8><title>Plan unavailable</title><p style=\"font-family:sans-serif;padding:24px\">The plan service is temporarily unavailable. <a href=\"/\">Back to the planner</a></p>");
  }
}
