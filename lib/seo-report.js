// Weekly SEO report: which Google searches are close to page 1, which pages get seen but not
// clicked, and what moved since the previous four weeks.
//
// GET /api/stats?report=seo   (also run automatically by the daily cron on Mondays, see api/stats.js)
// Reads Search Console with the same read-only service account as the daily report
// (GSC_SERVICE_ACCOUNT), compares the last 28 days with the 28 days before, stores the current
// query x page rows in Neon (table gsc_weekly, one snapshot per ISO week, for long-term trends)
// and emails the result to info@ with the full data attached as mtp-seo-<date>.json.
//
// Google's newest two days are still filling in, so the period ends three days ago.
import { neon } from "@neondatabase/serverless";
import { serviceAccountJwt } from "./daily-report.js";

const DAY = 86400000;
const ymd = d => new Date(d).toISOString().slice(0, 10);
const errText = e => String((e && e.message) || e).slice(0, 300);

// Rough share of clicks a result gets at a given position (public CTR studies, rounded).
// Used only to rank opportunities, not as a forecast.
const CTR_AT = [0, 0.28, 0.15, 0.10, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
export function expectedCtr(position) {
  const p = Math.max(1, Math.round(Number(position) || 100));
  return p < CTR_AT.length ? CTR_AT[p] : 0.01;
}

export function periods(now = Date.now()) {
  const end = now - 3 * DAY;
  return {
    current: { startDate: ymd(end - 27 * DAY), endDate: ymd(end) },
    previous: { startDate: ymd(end - 55 * DAY), endDate: ymd(end - 28 * DAY) }
  };
}

// Monday of the ISO week that contains `t`, as YYYY-MM-DD (the snapshot key).
export function weekOf(t) {
  const d = new Date(ymd(t) + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7;
  return ymd(d.getTime() - dow * DAY);
}

async function getJson(url, init, fetchImpl) {
  const r = await fetchImpl(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`not JSON: ${text.slice(0, 120)}`); }
}

const pathOf = url => {
  try { return new URL(url).pathname; } catch { return String(url || ""); }
};
const round1 = v => Math.round((Number(v) || 0) * 10) / 10;

// Pure analysis of the Search Console rows, so it can be tested without the network.
// cur / prev: arrays of { query, page, clicks, impressions, position } (page = full URL).
export function analyse(cur, prev, curPages = [], prevPages = []) {
  const key = r => r.query + "\u0000" + r.page;
  const prevMap = new Map(prev.map(r => [key(r), r]));
  const curMap = new Map(cur.map(r => [key(r), r]));
  const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const avgPos = rows => {
    const imp = sum(rows, "impressions");
    return imp ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / imp : 0;
  };

  // Searches on positions 4-30 with real impressions: a small improvement can bring them to page 1.
  // Ranked by the extra clicks they would get at position 3.
  const striking = cur
    .filter(r => r.position >= 4 && r.position <= 30 && r.impressions >= 5)
    .map(r => {
      const p = prevMap.get(key(r));
      return {
        query: r.query, page: pathOf(r.page), impressions: r.impressions, clicks: r.clicks,
        position: round1(r.position), prevPosition: p ? round1(p.position) : null,
        extraClicksAtPos3: Math.max(0, Math.round(r.impressions * expectedCtr(3) - r.clicks))
      };
    })
    .sort((a, b) => b.extraClicksAtPos3 - a.extraClicksAtPos3 || b.impressions - a.impressions)
    .slice(0, 40);

  // Pages Google shows often but people do not click: title / description are the first fix.
  const prevPageMap = new Map(prevPages.map(r => [r.page, r]));
  const lowCtrPages = curPages
    .filter(r => r.impressions >= 30 && r.clicks / r.impressions < expectedCtr(r.position) / 2)
    .map(r => {
      const tops = cur.filter(q => q.page === r.page).sort((a, b) => b.impressions - a.impressions).slice(0, 5).map(q => q.query);
      const p = prevPageMap.get(r.page);
      return { page: pathOf(r.page), impressions: r.impressions, clicks: r.clicks, ctr: round1(r.clicks / r.impressions * 100),
        position: round1(r.position), prevImpressions: p ? p.impressions : 0, topQueries: tops };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 20);

  // Movement on the same query x page between the two periods (only rows with enough data).
  const moved = [];
  for (const r of cur) {
    const p = prevMap.get(key(r));
    if (!p || r.impressions < 5 || p.impressions < 5) continue;
    moved.push({ query: r.query, page: pathOf(r.page), position: round1(r.position), prevPosition: round1(p.position),
      change: round1(p.position - r.position), impressions: r.impressions });
  }
  moved.sort((a, b) => b.change - a.change);
  const risers = moved.filter(m => m.change >= 2).slice(0, 15);
  const fallers = moved.filter(m => m.change <= -2).sort((a, b) => a.change - b.change).slice(0, 15);

  // Searches that are new this period (not seen at all before), by impressions.
  const newQueries = cur.filter(r => !prevMap.has(key(r)) && r.impressions >= 5)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15)
    .map(r => ({ query: r.query, page: pathOf(r.page), impressions: r.impressions, position: round1(r.position) }));

  // Searches already on page 1 (positions 1-3) — the wins to protect.
  const top3 = cur.filter(r => r.position < 3.5 && r.impressions >= 3)
    .sort((a, b) => b.impressions - a.impressions).slice(0, 15)
    .map(r => ({ query: r.query, page: pathOf(r.page), impressions: r.impressions, clicks: r.clicks, position: round1(r.position) }));

  const totals = rows => ({ impressions: sum(rows, "impressions"), clicks: sum(rows, "clicks"), position: round1(avgPos(rows)),
    queries: new Set(rows.map(r => r.query)).size, pages: new Set(rows.map(r => r.page)).size });
  return {
    totals: { current: totals(cur), previous: totals(prev) },
    striking, lowCtrPages, risers, fallers, newQueries, top3,
    seen: curMap.size
  };
}

async function gscQuery(fetchImpl) {
  const raw = process.env.GSC_SERVICE_ACCOUNT;
  if (!raw) throw new Error("GSC_SERVICE_ACCOUNT not configured");
  const sa = JSON.parse(raw);
  const site = process.env.GSC_SITE || "sc-domain:musicaltripplanner.com";
  const tok = await getJson(sa.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: serviceAccountJwt(sa) })
  }, fetchImpl);
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const q = (period, dimensions, rowLimit) => getJson(url, {
    method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...period, dimensions, rowLimit, dataState: "final" })
  }, fetchImpl).then(j => (j.rows || []).map(r => ({
    ...Object.fromEntries(dimensions.map((d, i) => [d, r.keys[i]])),
    clicks: r.clicks, impressions: r.impressions, position: r.position
  })));
  return { site, q };
}

let sqlClient;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

// One snapshot per ISO week; re-running in the same week replaces that week's rows.
export async function storeSnapshot(week, rows) {
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS gsc_weekly (
    week date NOT NULL, query text NOT NULL, page text NOT NULL,
    clicks int NOT NULL, impressions int NOT NULL, position real NOT NULL,
    PRIMARY KEY (week, query, page))`;
  await db`DELETE FROM gsc_weekly WHERE week = ${week}`;
  const top = rows.slice(0, 2000);
  if (!top.length) return 0;
  await db`INSERT INTO gsc_weekly (week, query, page, clicks, impressions, position)
    SELECT ${week}::date, q, p, c, i, pos FROM unnest(
      ${top.map(r => r.query)}::text[], ${top.map(r => pathOf(r.page))}::text[],
      ${top.map(r => Math.round(r.clicks))}::int[], ${top.map(r => Math.round(r.impressions))}::int[],
      ${top.map(r => r.position)}::real[]) AS t(q, p, c, i, pos)
    ON CONFLICT DO NOTHING`;
  return top.length;
}

// Weeks stored so far with their totals, newest first (for the trend line in the email).
export async function snapshotTrend() {
  const db = sql();
  return db`SELECT to_char(week, 'YYYY-MM-DD') AS week, sum(impressions)::int AS impressions, sum(clicks)::int AS clicks,
    count(DISTINCT query)::int AS queries FROM gsc_weekly GROUP BY week ORDER BY week DESC LIMIT 12`;
}

export async function buildSeoReport({ now = Date.now(), fetchImpl = fetch, store = true } = {}) {
  const per = periods(now);
  const out = { kind: "mtp-seo", version: 1, generatedAt: new Date(now).toISOString(), date: ymd(now), periods: per };
  try {
    const { site, q } = await gscQuery(fetchImpl);
    out.site = site;
    const [cur, prev, curPages, prevPages] = await Promise.all([
      q(per.current, ["query", "page"], 5000), q(per.previous, ["query", "page"], 5000),
      q(per.current, ["page"], 500), q(per.previous, ["page"], 500)
    ]);
    Object.assign(out, analyse(cur, prev, curPages, prevPages));
    if (store) {
      try {
        out.stored = await storeSnapshot(weekOf(now), cur);
        out.trend = await snapshotTrend();
      } catch (e) { out.storeError = errText(e); }
    }
  } catch (e) { out.error = errText(e); }
  return out;
}

// ---------------- email ----------------
const n = v => (Number(v) || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const esc = s => String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const posMove = (cur, prev) => (prev == null ? "new" : `${n(prev)} → ${n(cur)}`);

function sections(r) {
  const t = r.totals;
  const head = [
    `Google search, ${r.periods.current.startDate} to ${r.periods.current.endDate} (previous 28 days in brackets): ` +
    `${n(t.current.impressions)} impressions (${n(t.previous.impressions)}), ${n(t.current.clicks)} clicks (${n(t.previous.clicks)}), ` +
    `average position ${n(t.current.position)} (${n(t.previous.position)}), ${n(t.current.queries)} different searches (${n(t.previous.queries)}).`
  ];
  if (r.trend?.length > 1) head.push("Weekly snapshots: " + r.trend.slice().reverse().map(w => `${w.week} ${n(w.impressions)} impr / ${n(w.clicks)} clicks`).join(" · "));
  return [
    { title: "Summary", lines: head },
    { title: "Close to page 1 (position 4–30) — best chances first",
      cols: ["Search", "Page", "Impr.", "Clicks", "Position", "Extra clicks at #3"],
      rows: r.striking.slice(0, 20).map(s => [s.query, s.page, n(s.impressions), n(s.clicks), posMove(s.position, s.prevPosition), n(s.extraClicksAtPos3)]) },
    { title: "Seen but not clicked — rewrite title / description",
      cols: ["Page", "Impr.", "Clicks", "CTR %", "Position", "Top searches"],
      rows: r.lowCtrPages.slice(0, 12).map(p => [p.page, n(p.impressions), n(p.clicks), n(p.ctr), n(p.position), p.topQueries.join("; ")]) },
    { title: "Moved up", cols: ["Search", "Page", "Position", "Impr."], rows: r.risers.slice(0, 10).map(m => [m.query, m.page, posMove(m.position, m.prevPosition), n(m.impressions)]) },
    { title: "Moved down", cols: ["Search", "Page", "Position", "Impr."], rows: r.fallers.slice(0, 10).map(m => [m.query, m.page, posMove(m.position, m.prevPosition), n(m.impressions)]) },
    { title: "New searches this period", cols: ["Search", "Page", "Impr.", "Position"], rows: r.newQueries.slice(0, 10).map(m => [m.query, m.page, n(m.impressions), n(m.position)]) },
    { title: "Already top 3 — protect these", cols: ["Search", "Page", "Impr.", "Clicks", "Position"], rows: r.top3.slice(0, 10).map(m => [m.query, m.page, n(m.impressions), n(m.clicks), n(m.position)]) }
  ];
}

export function seoEmailBodies(r) {
  const subject = `Musical Trip Planner — weekly SEO ${r.date}`;
  let text = `${subject}\n\n`, html = `<h2>${esc(subject)}</h2>`;
  if (r.error) {
    text += `Search Console error: ${r.error}\n`;
    html += `<p>Search Console error: ${esc(r.error)}</p>`;
  } else {
    const td = 'style="padding:3px 8px;font-size:13px;border-bottom:1px solid #eee;vertical-align:top"';
    const th = 'style="padding:3px 8px;font-size:12px;color:#666;text-align:left;font-weight:normal"';
    for (const s of sections(r)) {
      text += `${s.title}\n`;
      html += `<h3 style="margin:16px 0 4px">${esc(s.title)}</h3>`;
      if (s.lines) {
        text += s.lines.map(l => "- " + l).join("\n") + "\n\n";
        html += `<ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>`;
        continue;
      }
      if (!s.rows.length) { text += "- (none)\n\n"; html += `<p style="color:#999">(none)</p>`; continue; }
      text += s.rows.map(row => "- " + row.map((c, i) => `${s.cols[i]}: ${c}`).join(" | ")).join("\n") + "\n\n";
      html += `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr>${s.cols.map(c => `<th ${th}>${esc(c)}</th>`).join("")}</tr>` +
        s.rows.map(row => `<tr>${row.map(c => `<td ${td}>${esc(c)}</td>`).join("")}</tr>`).join("") + `</table>`;
    }
    if (r.storeError) { text += `Snapshot not stored: ${r.storeError}\n`; html += `<p style="color:#999">Snapshot not stored: ${esc(r.storeError)}</p>`; }
  }
  const attachment = { filename: `mtp-seo-${r.date}.json`, content: Buffer.from(JSON.stringify(r)).toString("base64") };
  return { subject, text, html, attachments: [attachment] };
}

export async function emailSeoReport(r, fetchImpl = fetch) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const { subject, text, html, attachments } = seoEmailBodies(r);
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
