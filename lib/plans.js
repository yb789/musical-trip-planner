import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

// Shared itinerary storage on Neon Postgres (env DATABASE_URL = pooled connection string).
// One table, created on first use:
//   plans(code text primary key, data jsonb, created_at timestamptz, views int, ip_hash text)
// Plans are immutable once stored; a new share always creates a new code.
// ip_hash (salted SHA-256 of the creator's IP, never the IP itself) exists only for the
// per-IP creation limit below; it is never returned to visitors.

export const SITE = "https://musicaltripplanner.com";
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i to keep codes readable when dictated
const CODE_LENGTH = 6;
const MAX_BYTES = 60_000;
const CITIES = new Set(["london", "broadway"]);
// Creation limit: a browser creates a plan per Share click, so a real visitor needs a handful per hour.
export const MAX_PLANS_PER_HOUR = 20;

let sqlClient;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

let tableReady;
export function ensureTable() {
  if (!tableReady) {
    tableReady = sql()`CREATE TABLE IF NOT EXISTS plans (
      code text PRIMARY KEY,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      views integer NOT NULL DEFAULT 0
    )`.then(() => sql()`ALTER TABLE plans ADD COLUMN IF NOT EXISTS ip_hash text NOT NULL DEFAULT ''`)
      .then(() => sql()`CREATE INDEX IF NOT EXISTS plans_ip_hash_created_at ON plans (ip_hash, created_at)`)
      .catch(err => { tableReady = undefined; throw err; });
  }
  return tableReady;
}

export function randomCode() {
  let out = "";
  const bytes = new Uint8Array(CODE_LENGTH);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export function isValidCode(code) {
  return typeof code === "string" && /^[a-z0-9]{4,12}$/.test(code);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A real calendar date (rejects 2026-02-30, 2026-99-99).
export function isRealDate(s) {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function isoOffset(days) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

// Links in a shared plan are shown under our domain, so only hosts the planner itself
// produces are kept (anything else could be a fake ticket shop). Subdomains are allowed.
const LINK_HOSTS = [
  "seatplan.com",
  "londontheatre.co.uk",
  "londonboxoffice.co.uk",
  "broadway.com",
  "ticketmaster.com",
  "ticketmaster.co.uk",
  "musicaltripplanner.com"
];
export function safeLink(u) {
  if (typeof u !== "string" || u.length > 500) return "";
  let url;
  try { url = new URL(u); } catch { return ""; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  if (url.username || url.password) return "";
  const host = url.hostname.toLowerCase();
  return LINK_HOSTS.some(h => host === h || host.endsWith("." + h)) ? url.href : "";
}
function cleanChoice(c) {
  if (!c || typeof c !== "object" || typeof c.name !== "string" || !c.name.trim()) return null;
  const str = v => (typeof v === "string" ? v.slice(0, 500) : "");
  return {
    name: c.name.slice(0, 200),
    time: str(c.time),
    venue: str(c.venue),
    address: str(c.address),
    ticketUrl: safeLink(c.ticketUrl),
    infoUrl: safeLink(c.infoUrl),
    venueUrl: safeLink(c.venueUrl)
  };
  // bookingReference / ticket confirmations are deliberately NOT stored: they are private to the planner's browser.
}

// Validates and normalises a plan sent by the browser. Throws on bad input.
export function normalizePlan(input) {
  if (!input || typeof input !== "object") throw new Error("Plan must be an object");
  if (!CITIES.has(input.city)) throw new Error("Unknown city");
  const ranges = Array.isArray(input.ranges) ? input.ranges : [];
  const cleanRanges = ranges
    .filter(r => r && isRealDate(r.start) && isRealDate(r.end) && r.start <= r.end)
    .map(r => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 10);
  if (!cleanRanges.length) throw new Error("Plan needs at least one date range");
  // New plans are for upcoming trips: not ended (2-day grace for time zones), not more than ~3 years out.
  if (cleanRanges[cleanRanges.length - 1].end < isoOffset(-2)) throw new Error("Plan dates are in the past");
  if (cleanRanges[0].start > isoOffset(3 * 366)) throw new Error("Plan dates are too far in the future");
  const inRange = d => cleanRanges.some(r => d >= r.start && d <= r.end);
  const choices = {};
  let count = 0;
  for (const [date, sessions] of Object.entries(input.choices || {})) {
    if (!isRealDate(date) || !inRange(date) || !sessions || typeof sessions !== "object") continue;
    const day = {};
    for (const sess of ["matinee", "evening"]) {
      const c = cleanChoice(sessions[sess]);
      if (c) { day[sess] = c; count++; }
    }
    if (Object.keys(day).length) choices[date] = day;
  }
  if (!count) throw new Error("Plan has no chosen performances");
  const plan = { v: 1, city: input.city, ranges: cleanRanges, choices, title: typeof input.title === "string" ? input.title.slice(0, 80) : "" };
  if (JSON.stringify(plan).length > MAX_BYTES) throw new Error("Plan is too large");
  return plan;
}

export function hashIp(ip) {
  const salt = process.env.FEEDBACK_SALT || "musical-trip-planner-plans";
  return createHash("sha256").update(salt + "|" + String(ip || "")).digest("hex").slice(0, 32);
}

// Throws RateLimited when this IP has already created MAX_PLANS_PER_HOUR plans in the last hour.
export class RateLimited extends Error {
  constructor() { super("Too many plans created from this connection. Please try again in an hour."); this.name = "RateLimited"; }
}
export async function storePlan(plan, ip = "") {
  await ensureTable();
  const ipHash = hashIp(ip);
  const recent = await sql()`SELECT count(*)::int AS n FROM plans WHERE ip_hash = ${ipHash} AND created_at > now() - interval '1 hour'`;
  if ((recent[0]?.n || 0) >= MAX_PLANS_PER_HOUR) throw new RateLimited();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const rows = await sql()`INSERT INTO plans (code, data, ip_hash) VALUES (${code}, ${JSON.stringify(plan)}::jsonb, ${ipHash})
      ON CONFLICT (code) DO NOTHING RETURNING code`;
    if (rows.length) return code;
  }
  throw new Error("Could not allocate a plan code");
}

export async function loadPlan(code, { countView = false } = {}) {
  if (!isValidCode(code)) return null;
  await ensureTable();
  const rows = countView
    ? await sql()`UPDATE plans SET views = views + 1 WHERE code = ${code} RETURNING data, created_at, views`
    : await sql()`SELECT data, created_at, views FROM plans WHERE code = ${code}`;
  if (!rows.length) return null;
  const plan = sanitizeStoredPlan(rows[0].data);
  if (!plan) return null;
  return { plan, createdAt: rows[0].created_at, views: rows[0].views };
}

// Plans stored before the link allowlist (2026-10) may hold any URL or an impossible date.
// Re-check on every read: unsafe links are dropped, and a plan without a valid range is treated as missing.
export function sanitizeStoredPlan(plan) {
  if (!plan || typeof plan !== "object" || !CITIES.has(plan.city)) return null;
  const ranges = (Array.isArray(plan.ranges) ? plan.ranges : []).filter(r => r && isRealDate(r.start) && isRealDate(r.end) && r.start <= r.end);
  if (!ranges.length) return null;
  const choices = {};
  for (const [date, sessions] of Object.entries(plan.choices || {})) {
    if (!isRealDate(date) || !sessions || typeof sessions !== "object") continue;
    const day = {};
    for (const sess of ["matinee", "evening"]) {
      const c = sessions[sess];
      if (c && typeof c === "object" && typeof c.name === "string") {
        day[sess] = { ...c, ticketUrl: safeLink(c.ticketUrl), infoUrl: safeLink(c.infoUrl), venueUrl: safeLink(c.venueUrl) };
      }
    }
    if (Object.keys(day).length) choices[date] = day;
  }
  return { ...plan, ranges, choices };
}

// ---- presentation helpers shared by the plan page and the OG image ----

export function cityLabel(city) {
  return city === "london" ? "London · West End" : "New York · Broadway";
}
export function cityShort(city) {
  return city === "london" ? "London" : "New York";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtDay(iso, { weekday = true, year = false } = {}) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][dt.getUTCDay()];
  return `${weekday ? wd + " " : ""}${d} ${MONTHS[m - 1]}${year ? " " + y : ""}`;
}

export function rangeLabel(ranges) {
  const first = ranges[0].start, last = ranges[ranges.length - 1].end;
  const [y1, m1, d1] = first.split("-").map(Number);
  const [y2, m2, d2] = last.split("-").map(Number);
  if (first === last) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y1}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

export function planStats(plan) {
  let shows = 0;
  const names = [];
  for (const date of Object.keys(plan.choices).sort()) {
    for (const sess of ["matinee", "evening"]) {
      const c = plan.choices[date][sess];
      if (c) { shows++; if (!names.includes(c.name)) names.push(c.name); }
    }
  }
  return { shows, names, days: Object.keys(plan.choices).length };
}

export function planTitle(plan) {
  const { shows } = planStats(plan);
  return `${shows} musical${shows === 1 ? "" : "s"} in ${cityShort(plan.city)} · ${rangeLabel(plan.ranges)}`;
}
