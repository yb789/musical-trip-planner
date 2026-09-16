import { neon } from "@neondatabase/serverless";

// Shared itinerary storage on Neon Postgres (env DATABASE_URL = pooled connection string).
// One table, created on first use:
//   plans(code text primary key, data jsonb, created_at timestamptz, views int)
// Plans are immutable once stored; a new share always creates a new code.

export const SITE = "https://musicaltripplanner.com";
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i to keep codes readable when dictated
const CODE_LENGTH = 6;
const MAX_BYTES = 60_000;
const CITIES = new Set(["london", "broadway"]);

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
    )`.catch(err => { tableReady = undefined; throw err; });
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
function cleanChoice(c) {
  if (!c || typeof c !== "object" || typeof c.name !== "string" || !c.name.trim()) return null;
  const str = v => (typeof v === "string" ? v.slice(0, 500) : "");
  return {
    name: c.name.slice(0, 200),
    time: str(c.time),
    venue: str(c.venue),
    address: str(c.address),
    ticketUrl: /^https?:\/\//.test(c.ticketUrl || "") ? str(c.ticketUrl) : "",
    infoUrl: /^https?:\/\//.test(c.infoUrl || "") ? str(c.infoUrl) : "",
    venueUrl: /^https?:\/\//.test(c.venueUrl || "") ? str(c.venueUrl) : ""
  };
  // bookingReference / ticket confirmations are deliberately NOT stored: they are private to the planner's browser.
}

// Validates and normalises a plan sent by the browser. Throws on bad input.
export function normalizePlan(input) {
  if (!input || typeof input !== "object") throw new Error("Plan must be an object");
  if (!CITIES.has(input.city)) throw new Error("Unknown city");
  const ranges = Array.isArray(input.ranges) ? input.ranges : [];
  const cleanRanges = ranges
    .filter(r => r && ISO.test(r.start || "") && ISO.test(r.end || "") && r.start <= r.end)
    .map(r => ({ start: r.start, end: r.end }))
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 10);
  if (!cleanRanges.length) throw new Error("Plan needs at least one date range");
  const inRange = d => cleanRanges.some(r => d >= r.start && d <= r.end);
  const choices = {};
  let count = 0;
  for (const [date, sessions] of Object.entries(input.choices || {})) {
    if (!ISO.test(date) || !inRange(date) || !sessions || typeof sessions !== "object") continue;
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

export async function storePlan(plan) {
  await ensureTable();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const rows = await sql()`INSERT INTO plans (code, data) VALUES (${code}, ${JSON.stringify(plan)}::jsonb)
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
  return { plan: rows[0].data, createdAt: rows[0].created_at, views: rows[0].views };
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
