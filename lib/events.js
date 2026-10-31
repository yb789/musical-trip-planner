import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

// Own usage counter (Vercel's custom events need a paid plan).
// One table, created on first use:
//   events(id bigserial, created_at timestamptz, event text, page text, city text, seller text, show text, day_hash text)
// Nothing personal is stored: no IP, no user agent, no cookie. day_hash is a salted hash of
// (IP, UTC day) used only to count distinct visitors per day and to rate-limit; it cannot be
// reversed and changes every day.

export const EVENTS = new Set([
  "dates_chosen",   // Continue to planner clicked with dates
  "finished",       // "Yes, I'm finished" confirmed
  "export_excel",
  "export_pdf",
  "export_ics",       // Add to calendar (.ics) downloaded
  "share_open",     // Share plan dialog opened
  "share_created",  // share link created
  "ticket_click",   // affiliate link clicked (seller = seatplan | ticketmaster)
  "booked_marked",  // "Mark as booked" in the Book your tickets checklist / welcome-back toast
  "plan_opened",    // a shared plan imported with ?plan=
  "go_click",       // /go affiliate redirect, browser (stored by lib/go.js, not accepted from beacons)
  "go_bot"          // /go affiliate redirect, automated user agent
]);
const SERVER_ONLY = new Set(["go_click", "go_bot"]);
const CITIES = new Set(["london", "broadway", ""]);
const MAX_PER_DAY = 300; // per day_hash: a real visitor produces a few dozen at most

let sqlClient;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}
let tableReady;
export function ensureTable() {
  if (!tableReady) {
    tableReady = sql()`CREATE TABLE IF NOT EXISTS events (
      id bigserial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      event text NOT NULL,
      page text NOT NULL DEFAULT '',
      city text NOT NULL DEFAULT '',
      seller text NOT NULL DEFAULT '',
      show text NOT NULL DEFAULT '',
      day_hash text NOT NULL DEFAULT ''
    )`.then(() => sql()`CREATE INDEX IF NOT EXISTS events_created_at ON events (created_at)`)
      .catch(err => { tableReady = undefined; throw err; });
  }
  return tableReady;
}

export function dayHash(ip) {
  const salt = process.env.FEEDBACK_SALT || "musical-trip-planner-events";
  const day = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update(salt + "|" + day + "|" + String(ip || "")).digest("hex").slice(0, 24);
}

const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
// Validates a beacon from the browser. Returns null when it should be ignored.
export function normalizeEvent(input) {
  if (!input || typeof input !== "object") return null;
  if (!EVENTS.has(input.event) || SERVER_ONLY.has(input.event)) return null;
  const page = str(input.page, 120).replace(/[?#].*$/, "");
  if (page && !page.startsWith("/")) return null;
  const city = str(input.city, 10).toLowerCase();
  return {
    event: input.event,
    page,
    city: CITIES.has(city) ? city : "",
    seller: str(input.seller, 20).toLowerCase().replace(/[^a-z]/g, ""),
    show: str(input.show, 80)
  };
}

export async function storeEvent(ev, ip = "") {
  // Two cold functions can race on CREATE TABLE IF NOT EXISTS (Postgres then reports a duplicate
  // pg_type/pg_class key for the loser); the table exists after that, so one retry is enough.
  try { await ensureTable(); } catch { await ensureTable(); }
  const h = dayHash(ip);
  const n = await sql()`SELECT count(*)::int AS n FROM events WHERE day_hash = ${h} AND created_at > now() - interval '1 day'`;
  if ((n[0]?.n || 0) >= MAX_PER_DAY) return false;
  await sql()`INSERT INTO events (event, page, city, seller, show, day_hash)
    VALUES (${ev.event}, ${ev.page}, ${ev.city}, ${ev.seller}, ${ev.show}, ${h})`;
  return true;
}

// Totals for the last `days` days: by event, by day, ticket clicks by seller and by show.
export async function stats(days = 30) {
  await ensureTable();
  const d = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date(Date.now() - d * 86400000).toISOString();
  const byEvent = await sql()`SELECT event, count(*)::int AS n, count(DISTINCT day_hash)::int AS visitors
    FROM events WHERE created_at > ${since} GROUP BY event ORDER BY n DESC`;
  const byDay = await sql()`SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, event, count(*)::int AS n
    FROM events WHERE created_at > ${since} GROUP BY 1, 2 ORDER BY 1, 2`;
  const bySeller = await sql()`SELECT seller, city, count(*)::int AS n FROM events
    WHERE event = 'ticket_click' AND created_at > ${since} GROUP BY seller, city ORDER BY n DESC`;
  const byShow = await sql()`SELECT show, city, count(*)::int AS n FROM events
    WHERE event = 'ticket_click' AND show <> '' AND created_at > ${since} GROUP BY show, city ORDER BY n DESC LIMIT 30`;
  const byPage = await sql()`SELECT page, count(*)::int AS n FROM events
    WHERE event = 'ticket_click' AND created_at > ${since} GROUP BY page ORDER BY n DESC LIMIT 30`;
  const goClicks = await sql()`SELECT event, seller, city, split_part(show, '-', 1) AS source, count(*)::int AS n FROM events
    WHERE event IN ('go_click', 'go_bot') AND created_at > ${since} GROUP BY 1, 2, 3, 4 ORDER BY n DESC`;
  const goByShow = await sql()`SELECT show, count(*)::int AS n FROM events
    WHERE event = 'go_click' AND created_at > ${since} GROUP BY show ORDER BY n DESC LIMIT 30`;
  const days_ = {};
  for (const r of byDay) (days_[r.day] ||= {})[r.event] = r.n;
  return { days: d, since, byEvent, byDay: days_, ticketClicks: { bySeller, byShow, byPage }, goClicks: { bySource: goClicks, byShow: goByShow } };
}
