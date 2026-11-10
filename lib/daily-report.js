// Daily stats report for the owner's dashboard.
//
// GET /api/stats?report=daily  (Vercel cron, see vercel.json "crons"; Authorization: Bearer <CRON_SECRET>)
// Gathers, for the last 30 days:
//   site   - our own counter in Neon (page views by day / country / page / referrer, planner actions,
//            ticket clicks, /go redirects) — lib/events.js stats()
//   impact - Impact.com partner API (read-only token): actions (sales + commission) per programme and
//            per subId1 (= which page / show), plus the "Performance by Day" and "Performance by
//            Sub ID" reports (clicks) when the account exposes them to the API
//   gsc    - Google Search Console API (service account, read-only): totals, per day, top queries,
//            top pages, countries
// and emails the result to info@ (FEEDBACK_TO) through Resend. The email has a short human summary and
// a 7-day bar chart; the full data is attached as mtp-daily-<date>.json for the dashboard
// (scripts/dashboard_data.py). Each source fails on its own: its section then holds {error} and
// the rest of the report is still sent.
//
// Env: IMPACT_ACCOUNT_SID, IMPACT_AUTH_TOKEN, GSC_SERVICE_ACCOUNT (the service account's JSON key),
//      GSC_SITE (default "sc-domain:musicaltripplanner.com"), RESEND_API_KEY, FEEDBACK_FROM, FEEDBACK_TO.
import { latestLinkCheck, linkCheckLines } from "./link-check.js";
import { createSign } from "node:crypto";
import { stats } from "./events.js";

const DAY = 86400000;
const ymd = d => new Date(d).toISOString().slice(0, 10);
const errText = e => String((e && e.message) || e).slice(0, 300);

async function getJson(url, init, fetchImpl) {
  const r = await fetchImpl(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`not JSON: ${text.slice(0, 120)}`); }
}

// ---------------- Impact.com ----------------
export function summarizeActions(actions) {
  const num = v => Number(v) || 0;
  const by = (key) => {
    const m = new Map();
    for (const a of actions) {
      const k = String(a[key] || "");
      const o = m.get(k) || { [key === "CampaignName" ? "programme" : "subId1"]: k, actions: 0, payout: 0, amount: 0 };
      o.actions++; o.payout += num(a.Payout); o.amount += num(a.Amount);
      m.set(k, o);
    }
    return [...m.values()].sort((x, y) => y.payout - x.payout || y.actions - x.actions);
  };
  const states = {};
  for (const a of actions) states[a.State || "UNKNOWN"] = (states[a.State || "UNKNOWN"] || 0) + 1;
  const currencies = [...new Set(actions.map(a => a.Currency).filter(Boolean))];
  return {
    count: actions.length,
    payout: actions.reduce((s, a) => s + num(a.Payout), 0),
    amount: actions.reduce((s, a) => s + num(a.Amount), 0),
    currencies, states,
    byProgramme: by("CampaignName"),
    bySubId1: by("SubId1").slice(0, 40),
    recent: actions
      .slice().sort((x, y) => String(y.EventDate).localeCompare(String(x.EventDate))).slice(0, 25)
      .map(a => ({ date: String(a.EventDate || "").slice(0, 10), programme: a.CampaignName || "", state: a.State || "",
        payout: num(a.Payout), amount: num(a.Amount), currency: a.Currency || "", subId1: a.SubId1 || "" }))
  };
}

const REPORTS_WANTED = [
  { key: "byDay", re: /performance by day/i },
  { key: "bySubId", re: /performance by sub ?id/i },
  { key: "byBrand", re: /performance by (brand|program|campaign)/i }
];

export async function impactReport({ now = Date.now(), fetchImpl = fetch } = {}) {
  const sid = process.env.IMPACT_ACCOUNT_SID, token = process.env.IMPACT_AUTH_TOKEN;
  if (!sid || !token) return { error: "IMPACT_ACCOUNT_SID / IMPACT_AUTH_TOKEN not configured" };
  const base = `https://api.impact.com/Mediapartners/${encodeURIComponent(sid)}`;
  const init = { headers: { Accept: "application/json", Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") } };
  const out = { period: { start: ymd(now - 30 * DAY), end: ymd(now) } };

  // Actions (sales). ActionDateStart/End filter on the event date; follow @nextpageuri if present.
  try {
    const all = [];
    let url = `${base}/Actions?ActionDateStart=${ymd(now - 30 * DAY)}T00:00:00Z&ActionDateEnd=${new Date(now).toISOString().slice(0, 19)}Z`;
    for (let page = 0; url && page < 10; page++) {
      const j = await getJson(url, init, fetchImpl);
      all.push(...(Array.isArray(j.Actions) ? j.Actions : []));
      const next = j["@nextpageuri"];
      url = next ? `https://api.impact.com${next}` : "";
    }
    out.actions = summarizeActions(all);
  } catch (e) { out.actions = { error: errText(e) }; }

  // Reports (clicks). Report ids differ per account, so find them by name in the list.
  try {
    const list = await getJson(`${base}/Reports`, init, fetchImpl);
    const reports = (Array.isArray(list.Reports) ? list.Reports : []).filter(r => r.ApiAccessible === true || r.ApiAccessible === "true");
    out.reportsAvailable = reports.map(r => ({ id: r.Id, name: r.Name, category: r.Category })).slice(0, 80);
    out.reports = {};
    for (const w of REPORTS_WANTED) {
      const r = reports.find(x => w.re.test(String(x.Name || "")));
      if (!r) { out.reports[w.key] = { error: "no API-accessible report with that name" }; continue; }
      try {
        const q = `START_DATE=${ymd(now - 30 * DAY)}&END_DATE=${ymd(now)}`;
        const j = await getJson(`${base}/Reports/${encodeURIComponent(r.Id)}?${q}`, init, fetchImpl);
        const records = Array.isArray(j.Records) ? j.Records : [];
        out.reports[w.key] = { id: r.Id, name: r.Name, rows: records.length, records: records.slice(0, 200) };
      } catch (e) { out.reports[w.key] = { id: r.Id, name: r.Name, error: errText(e) }; }
    }
  } catch (e) { out.reportsError = errText(e); }
  return out;
}

// ---------------- Google Search Console ----------------
const b64url = b => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function serviceAccountJwt(sa, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: sa.token_uri || "https://oauth2.googleapis.com/token", iat, exp: iat + 3600
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  return `${header}.${claim}.${b64url(signer.sign(sa.private_key))}`;
}

export async function gscReport({ now = Date.now(), fetchImpl = fetch } = {}) {
  const raw = process.env.GSC_SERVICE_ACCOUNT;
  if (!raw) return { error: "GSC_SERVICE_ACCOUNT not configured" };
  let sa;
  try { sa = JSON.parse(raw); } catch { return { error: "GSC_SERVICE_ACCOUNT is not valid JSON" }; }
  if (!sa.client_email || !sa.private_key) return { error: "GSC_SERVICE_ACCOUNT lacks client_email / private_key" };
  const site = process.env.GSC_SITE || "sc-domain:musicaltripplanner.com";
  try {
    const tok = await getJson(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountJwt(sa, now) })
    }, fetchImpl);
    const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
    const startDate = ymd(now - 30 * DAY), endDate = ymd(now - DAY);
    const q = (dimensions, rowLimit) => getJson(url, {
      method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate, dimensions, rowLimit, dataState: "all" })
    }, fetchImpl).then(j => (j.rows || []).map(r => ({
      ...(dimensions.length ? Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i]])) : {}),
      clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position
    })));
    const [total, byDate, byQuery, byPage, byCountry] = await Promise.all([
      q([], 1), q(["date"], 40), q(["query"], 30), q(["page"], 30), q(["country"], 20)
    ]);
    return { site, period: { start: startDate, end: endDate }, total: total[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 }, byDate, byQuery, byPage, byCountry };
  } catch (e) { return { site, error: errText(e) }; }
}

// ---------------- report + email ----------------
export async function buildDailyReport({ now = Date.now(), fetchImpl = fetch, statsImpl = stats, linkCheckImpl = latestLinkCheck } = {}) {
  const [site, impact, gsc, linkCheck] = await Promise.all([
    statsImpl(30).catch(e => ({ error: errText(e) })),
    impactReport({ now, fetchImpl }).catch(e => ({ error: errText(e) })),
    gscReport({ now, fetchImpl }).catch(e => ({ error: errText(e) })),
    linkCheckImpl().catch(e => ({ error: errText(e) }))
  ]);
  return { kind: "mtp-daily", version: 1, generatedAt: new Date(now).toISOString(), date: ymd(now), site, impact, gsc, linkCheck };
}

const n = v => (Number(v) || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const pct = (a, b) => (b ? ` (${Math.round(a / b * 100)}%)` : "");

let regionNames;
try { regionNames = new Intl.DisplayNames(["en"], { type: "region" }); } catch { regionNames = null; }
// "GB" -> "United Kingdom". Full names also stop Gmail turning "GB 99, US 24" into a phone-number link.
export function countryName(code) {
  const c = String(code || "").toUpperCase();
  if (!c) return "Unknown";
  try { return (regionNames && regionNames.of(c)) || c; } catch { return c; }
}

// Referring host -> a readable source name ("" = no referrer: typed in, a bookmark, or an app that hides it).
const SOURCES = [
  [/(^|\.)reddit\.com$|^com\.reddit\.|^redd\.it$/i, "Reddit"],
  [/^news\.ycombinator\.com$/i, "Hacker News"],
  [/(^|\.)google\.[a-z.]+$|^com\.google\./i, "Google"],
  [/(^|\.)bing\.com$/i, "Bing"],
  [/(^|\.)duckduckgo\.com$/i, "DuckDuckGo"],
  [/(^|\.)facebook\.com$|^com\.facebook\./i, "Facebook"],
  [/(^|\.)instagram\.com$|^com\.instagram\./i, "Instagram"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/i, "X / Twitter"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/i, "LinkedIn"],
  [/(^|\.)whatsapp\.(com|net)$/i, "WhatsApp"],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/i, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/i, "Perplexity"],
  [/(^|\.)claude\.ai$/i, "Claude"]
];
export function sourceName(ref) {
  const h = String(ref || "").toLowerCase();
  if (!h) return "Direct / app (no source)";
  for (const [re, name] of SOURCES) if (re.test(h)) return name;
  return h.replace(/^www\./, "");
}

// "planner-hamilton-london" -> "Hamilton london": the /go subId is <where>-<show id>.
export function showName(subId) {
  const id = String(subId || "");
  if (id === "shared-plan") return "(from a shared plan)";
  if (id === "planner-concert") return "Concerts";
  const s = id.split("-").slice(1).join(" ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "(no show)";
}

const weekday = day => new Date(day + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// Impact's "Performance by Day" report: { "2026-11-05": clicks }.
function impactClicksByDay(r) {
  const out = {};
  for (const rec of r.impact?.reports?.byDay?.records || []) {
    const t = Date.parse(String(rec.date_display || "") + " UTC");
    if (!Number.isNaN(t)) out[ymd(t)] = (out[ymd(t)] || 0) + (Number(rec.Clicks) || 0);
  }
  return out;
}

// Yesterday (the last full UTC day) in detail: where visitors came from, what they did, which shows.
export function yesterday(r) {
  const day = ymd(Date.parse(r.date) - DAY);
  const rec = r.site?.recent;
  if (!rec) return { day, available: false };
  const ev = Object.fromEntries((rec.events || []).filter(e => e.day === day).map(e => [e.event, e]));
  const v = k => ev[k]?.visitors || 0;
  // Only page views that arrived from another site carry a referrer; a move between our own pages has
  // none, so "Direct" = the day's visitors not seen arriving from anywhere else (an estimate).
  const sources = new Map();
  for (const x of (rec.referrers || []).filter(x => x.day === day && x.ref)) {
    const k = sourceName(x.ref);
    sources.set(k, (sources.get(k) || 0) + x.visitors);
  }
  const external = [...sources.values()].reduce((s, c) => s + c, 0);
  const direct = Math.max(0, v("pageview") - external);
  if (direct) sources.set(sourceName(""), direct);
  const shows = new Map();
  for (const x of (rec.goShows || []).filter(x => x.day === day)) {
    const k = showName(x.show);
    shows.set(k, (shows.get(k) || 0) + x.n);
  }
  const imp = impactClicksByDay(r);
  return {
    day, available: true,
    visitors: v("pageview"), views: ev.pageview?.n || 0,
    sources: [...sources].sort((a, b) => b[1] - a[1]),
    funnel: { visitors: v("pageview"), dates: v("dates_chosen"), finished: v("finished"), ticketPeople: v("go_click"), ticketClicks: ev.go_click?.n || 0 },
    shows: [...shows].sort((a, b) => b[1] - a[1]),
    impactClicks: day in imp ? imp[day] : null
  };
}

const list = (pairs, max) => {
  const top = pairs.slice(0, max).map(([k, c]) => `${k} ${n(c)}`);
  const rest = pairs.slice(max).reduce((s, [, c]) => s + c, 0);
  return top.join(" · ") + (rest ? ` · others ${n(rest)}` : "");
};

export function yesterdayLines(r) {
  const y = yesterday(r);
  if (!y.available) return [];
  const f = y.funnel, L = [];
  L.push(`${n(y.visitors)} visitors, ${n(y.views)} page views.`);
  if (y.sources.length) L.push(`Where they came from: ${list(y.sources, 6)}.`);
  L.push(`What they did: ${n(f.visitors)} visitors → ${n(f.dates)} chose dates${pct(f.dates, f.visitors)} → ${n(f.finished)} finished a plan${pct(f.finished, f.visitors)} → ` +
    `${n(f.ticketPeople)} clicked a ticket link${pct(f.ticketPeople, f.visitors)}, ${n(f.ticketClicks)} clicks in all.`);
  if (y.shows.length) L.push(`Ticket clicks by show: ${list(y.shows, 8)}.`);
  if (y.impactClicks != null) L.push(`The sellers (via Impact) recorded ${n(y.impactClicks)} clicks that day.`);
  return L;
}

export function summaryLines(r) {
  const L = [];
  const pv = r.site?.pageviews;
  if (r.site?.error) L.push(`Site counter: error ${r.site.error}`);
  else if (pv) {
    L.push(`Site: ${n(pv.total?.views)} page views.`);
    const top = (pv.byCountry || []).slice(0, 5).map(c => `${countryName(c.country)} ${n(c.visitors)}`).join(" · ");
    if (top) L.push(`Visitors by country: ${top}.`);
  }
  const go = r.site?.goClicks?.bySource || [];
  const human = go.filter(g => g.event === "go_click").reduce((s, g) => s + g.n, 0);
  const bots = go.filter(g => g.event === "go_bot").reduce((s, g) => s + g.n, 0);
  L.push(`Ticket link clicks through /go: ${n(human)} by people, ${n(bots)} by bots.`);
  const a = r.impact?.actions;
  const brandClicks = (r.impact?.reports?.byBrand?.records || []).reduce((s, b) => s + (Number(b.Clicks) || 0), 0);
  if (r.impact?.error) L.push(`Impact: error ${r.impact.error}`);
  else if (a?.error) L.push(`Impact sales: error ${a.error}`);
  else if (a) L.push(`Impact: ${brandClicks ? `${n(brandClicks)} clicks recorded by the sellers, ` : ""}${a.count} sales, commission ${n(a.payout)} ${a.currencies.join("/") || ""}`.trim() + ". (Sales can take a few days to appear.)");
  const g = r.gsc;
  if (g?.error) L.push(`Search Console: error ${g.error}`);
  else if (g?.total) L.push(`Google search (${g.period.start} to ${g.period.end}): ${n(g.total.impressions)} impressions, ${n(g.total.clicks)} clicks, average position ${n(g.total.position)}.`);
  return L;
}

// The last 7 full days (UTC, oldest first): site visitors / page views, people's ticket-link clicks
// through /go, and Google search impressions / clicks. Search Console lags 2–3 days and its newest
// day is still filling in, so that day is marked partial.
export function lastWeek(r) {
  const pvByDay = new Map((r.site?.pageviews?.byDay || []).map(d => [d.day, d]));
  const gscByDay = new Map((r.gsc?.byDate || []).map(d => [d.date, d]));
  const gscLast = [...gscByDay.keys()].sort().pop() || "";
  const end = Date.parse(r.date);
  const out = [];
  for (let i = 7; i >= 1; i--) {
    const day = ymd(end - i * DAY);
    const pv = pvByDay.get(day), g = gscByDay.get(day);
    out.push({
      day, visitors: pv?.visitors || 0, views: pv?.views || 0,
      goClicks: r.site?.byDay?.[day]?.go_click || 0,
      gscImpressions: g ? g.impressions : null, gscClicks: g ? g.clicks : null,
      gscPartial: !!g && day === gscLast && end - Date.parse(day) <= 3 * DAY
    });
  }
  return out;
}

function weekText(week) {
  const max = Math.max(1, ...week.map(w => w.visitors));
  const rows = week.map(w => {
    const bar = "█".repeat(Math.round(w.visitors / max * 20)) || "·";
    const g = w.gscImpressions == null ? "–" : `${n(w.gscImpressions)} impr / ${n(w.gscClicks)} clicks${w.gscPartial ? " (partial)" : ""}`;
    return `${weekday(w.day).padEnd(11)} ${bar.padEnd(20)} ${String(w.visitors).padStart(4)} visitors · ${w.goClicks} ticket clicks · Google ${g}`;
  });
  return `Last 7 days\n${rows.join("\n")}`;
}

function weekHtml(week) {
  const max = Math.max(1, ...week.map(w => w.visitors));
  const td = 'style="padding:3px 8px;font-size:13px;white-space:nowrap"';
  const th = 'style="padding:3px 8px;font-size:12px;color:#666;text-align:left;font-weight:normal"';
  const rows = week.map(w => {
    const px = Math.max(w.visitors ? 3 : 0, Math.round(w.visitors / max * 180));
    const bar = px ? `<div style="background:#b0204a;height:14px;width:${px}px;border-radius:2px"></div>` : `<span style="color:#bbb">·</span>`;
    const g = w.gscImpressions == null ? '<span style="color:#bbb">–</span>'
      : w.gscPartial ? `<span style="color:#999">${n(w.gscImpressions)} / ${n(w.gscClicks)}*</span>` : `${n(w.gscImpressions)} / ${n(w.gscClicks)}`;
    return `<tr><td ${td}>${esc(weekday(w.day))}</td><td style="padding:3px 8px;width:190px">${bar}</td>` +
      `<td ${td} align="right"><b>${w.visitors}</b></td><td ${td} align="right">${w.views}</td>` +
      `<td ${td} align="right">${w.goClicks}</td><td ${td} align="right">${g}</td></tr>`;
  }).join("");
  const note = week.some(w => w.gscPartial) ? `<p style="color:#999;font-size:12px;margin:4px 8px">* Google's newest day is still filling in.</p>` : "";
  return `<h3 style="margin:18px 0 6px">Last 7 days</h3>` +
    `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse">` +
    `<tr><th ${th}>Day</th><th ${th}>Visitors</th><th ${th}></th><th ${th}>Page views</th><th ${th}>Ticket clicks</th><th ${th}>Google impr. / clicks</th></tr>` +
    rows + `</table>` + note;
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const ul = lines => `<ul>${lines.map(l => `<li style="margin:3px 0">${esc(l)}</li>`).join("")}</ul>`;
// The email holds the readable summary: yesterday in detail, the last 30 days and the 7-day chart.
// The full data travels as an attached JSON file (mtp-daily-<date>.json), which
// scripts/dashboard_data.py reads directly.
export function emailBodies(r) {
  const yLines = yesterdayLines(r);
  const lines = summaryLines(r);
  const lLines = linkCheckLines(r.linkCheck);
  const week = lastWeek(r);
  const yHead = `Yesterday, ${weekday(ymd(Date.parse(r.date) - DAY))}`;
  const text = `Musical Trip Planner — daily stats ${r.date}\n\n` +
    (yLines.length ? `${yHead}\n${yLines.map(l => "- " + l).join("\n")}\n\n` : "") +
    `Ticket links\n${lLines.map(l => "- " + l).join("\n")}\n\n` +
    `Last 30 days\n${lines.map(l => "- " + l).join("\n")}\n\n${weekText(week)}\n`;
  const html = `<h2>Musical Trip Planner — daily stats ${esc(r.date)}</h2>` +
    (yLines.length ? `<h3 style="margin:14px 0 4px">${esc(yHead)}</h3>${ul(yLines)}` : "") +
    `<h3 style="margin:14px 0 4px">Ticket links</h3>${ul(lLines)}` +
    `<h3 style="margin:14px 0 4px">Last 30 days</h3>${ul(lines)}` + weekHtml(week);
  const attachment = { filename: `mtp-daily-${r.date}.json`, content: Buffer.from(JSON.stringify(r)).toString("base64") };
  return { subject: `Musical Trip Planner — daily stats ${r.date}`, text, html, attachments: [attachment] };
}

export async function emailDailyReport(r, fetchImpl = fetch) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const { subject, text, html, attachments } = emailBodies(r);
  const resp = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FEEDBACK_FROM || "Musical Trip Planner <feedback@musicaltripplanner.com>",
      to: [process.env.FEEDBACK_TO || "info@musicaltripplanner.com"],
      subject, text, html, attachments
    })
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}`);
  return true;
}
