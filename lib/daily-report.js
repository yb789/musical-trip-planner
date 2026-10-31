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
// the full data as JSON between the markers MTP-DATA-BEGIN / MTP-DATA-END, which the dashboard's
// scheduled task reads from Gmail. Each source fails on its own: its section then holds {error} and
// the rest of the report is still sent.
//
// Env: IMPACT_ACCOUNT_SID, IMPACT_AUTH_TOKEN, GSC_SERVICE_ACCOUNT (the service account's JSON key),
//      GSC_SITE (default "sc-domain:musicaltripplanner.com"), RESEND_API_KEY, FEEDBACK_FROM, FEEDBACK_TO.
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
export async function buildDailyReport({ now = Date.now(), fetchImpl = fetch, statsImpl = stats } = {}) {
  const [site, impact, gsc] = await Promise.all([
    statsImpl(30).catch(e => ({ error: errText(e) })),
    impactReport({ now, fetchImpl }).catch(e => ({ error: errText(e) })),
    gscReport({ now, fetchImpl }).catch(e => ({ error: errText(e) }))
  ]);
  return { kind: "mtp-daily", version: 1, generatedAt: new Date(now).toISOString(), date: ymd(now), site, impact, gsc };
}

const n = v => (Number(v) || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
export function summaryLines(r) {
  const L = [];
  const pv = r.site?.pageviews;
  if (r.site?.error) L.push(`Site counter: error ${r.site.error}`);
  else if (pv) {
    const yesterday = ymd(Date.parse(r.date) - DAY);
    const y = (pv.byDay || []).find(d => d.day === yesterday);
    L.push(`Site, last 30 days: ${n(pv.total?.views)} page views; yesterday ${n(y?.views)} views from ${n(y?.visitors)} visitors.`);
    const top = (pv.byCountry || []).slice(0, 5).map(c => `${c.country || "?"} ${c.visitors}`).join(", ");
    if (top) L.push(`Visitors by country (30 days): ${top}.`);
  }
  const go = r.site?.goClicks?.bySource || [];
  const human = go.filter(g => g.event === "go_click").reduce((s, g) => s + g.n, 0);
  const bots = go.filter(g => g.event === "go_bot").reduce((s, g) => s + g.n, 0);
  L.push(`Ticket link clicks through /go (30 days): ${n(human)} people, ${n(bots)} bots.`);
  const a = r.impact?.actions;
  if (r.impact?.error) L.push(`Impact: error ${r.impact.error}`);
  else if (a?.error) L.push(`Impact actions: error ${a.error}`);
  else if (a) L.push(`Impact, last 30 days: ${a.count} sales, commission ${n(a.payout)} ${a.currencies.join("/") || ""}`.trim() + ".");
  const g = r.gsc;
  if (g?.error) L.push(`Search Console: error ${g.error}`);
  else if (g?.total) L.push(`Google search (${g.period.start} to ${g.period.end}): ${n(g.total.impressions)} impressions, ${n(g.total.clicks)} clicks, average position ${n(g.total.position)}.`);
  return L;
}

const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
export function emailBodies(r) {
  const lines = summaryLines(r);
  const json = JSON.stringify(r);
  const text = `Musical Trip Planner — daily stats ${r.date}\n\n${lines.join("\n")}\n\n` +
    `The dashboard reads the data below. Please don't edit or forward this email to the dashboard yourself.\n` +
    `MTP-DATA-BEGIN\n${json}\nMTP-DATA-END\n`;
  const html = `<h2>Musical Trip Planner — daily stats ${esc(r.date)}</h2><ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` +
    `<p style="color:#888;font-size:12px">The dashboard reads the data below.</p>` +
    `<pre style="font-size:10px;white-space:pre-wrap;word-break:break-all">MTP-DATA-BEGIN\n${esc(json)}\nMTP-DATA-END</pre>`;
  return { subject: `Musical Trip Planner — daily stats ${r.date}`, text, html };
}

export async function emailDailyReport(r, fetchImpl = fetch) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const { subject, text, html } = emailBodies(r);
  const resp = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FEEDBACK_FROM || "Musical Trip Planner <feedback@musicaltripplanner.com>",
      to: [process.env.FEEDBACK_TO || "info@musicaltripplanner.com"],
      subject, text, html
    })
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}`);
  return true;
}
