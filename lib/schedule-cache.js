// Stored copy of the live schedule for the matinee pages (Neon table schedule_cache).
// A live read of one week takes several seconds, and Vercel's page cache is per region, so the first
// visitor to each week in each region used to wait. Now the page reads the stored copy (one quick
// query) and a nightly job (/api/stats?report=warm) keeps the copies fresh. Without a database, or
// if it fails, everything falls back to the live read: the page never depends on the cache.
import { neon } from "@neondatabase/serverless";
import { loadSchedule } from "./schedule-data.js";
import { matineeWeekOptions } from "./site-pages.js";

const iso = d => d.toISOString().slice(0, 10);
const HOUR = 3600 * 1000;
const FRESH_MS = 36 * HOUR;       // a stored copy older than this is re-read live on the next visit
const WARM_SKIP_MS = 20 * HOUR;   // the nightly job leaves copies newer than this alone
const count = data => Object.values((data && data.schedule) || {}).reduce((n, list) => n + list.length, 0);

let client, ready;
function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!client) client = neon(process.env.DATABASE_URL);
  return client;
}
function ensure() {
  if (!ready) ready = db()`CREATE TABLE IF NOT EXISTS schedule_cache (
      key text PRIMARY KEY,
      start_date date NOT NULL,
      data jsonb NOT NULL,
      refreshed_at timestamptz NOT NULL DEFAULT now()
    )`.catch(err => { ready = undefined; throw err; });
  return ready;
}
export const neonStore = {
  async get(key) {
    await ensure();
    const r = await db()`SELECT data, refreshed_at FROM schedule_cache WHERE key = ${key}`;
    return r[0] ? { data: r[0].data, at: new Date(r[0].refreshed_at) } : null;
  },
  async put(key, start, data) {
    await ensure();
    await db()`INSERT INTO schedule_cache (key, start_date, data, refreshed_at) VALUES (${key}, ${start}, ${JSON.stringify(data)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, start_date = EXCLUDED.start_date, refreshed_at = now()`;
  },
  async ages() {
    await ensure();
    const r = await db()`SELECT key, refreshed_at FROM schedule_cache`;
    return new Map(r.map(x => [x.key, new Date(x.refreshed_at)]));
  },
  async prune(before) {
    await ensure();
    await db()`DELETE FROM schedule_cache WHERE start_date < ${before}`;
  }
};

const keyOf = (citySlug, start) => `${citySlug}|${iso(start)}`;

// Live read, then store. A read that comes back empty never replaces a stored copy that has
// performances (a hiccup at the listing site would otherwise blank the page for a day).
async function readAndStore(citySlug, start, hit, { store, load }) {
  const data = await load(citySlug, start);
  if (hit && !count(data) && count(hit.data)) return hit.data;
  try { await store.put(keyOf(citySlug, start), iso(start), data); }
  catch (err) { console.error("schedule cache write failed", err?.message || err); }
  return data;
}

// Same result shape as loadSchedule(). opts.store / opts.load / opts.now exist for tests.
export async function cachedSchedule(citySlug, start, opts = {}) {
  const store = opts.store || neonStore, load = opts.load || loadSchedule, now = opts.now || Date.now();
  let hit = null;
  try { hit = await store.get(keyOf(citySlug, start)); }
  catch (err) { console.error("schedule cache read failed", err?.message || err); }
  if (hit && now - hit.at.getTime() < FRESH_MS) return hit.data;
  try { return await readAndStore(citySlug, start, hit, { store, load }); }
  catch (err) {
    if (!hit) throw err;
    console.error("live schedule failed, serving the stored copy", citySlug, iso(start), err?.message || err);
    return hit.data;      // an older copy beats an error page
  }
}

// Nightly: refresh the stored copies for both cities (today's 7 days plus the weeks in the picker).
// The two cities read different listing sites, so they run side by side; within a city one week at a
// time, oldest copy first, until the time budget is used. Whatever doesn't fit is first in line the
// next night, and a visit to a copy older than 36 hours refreshes it anyway.
export async function warmSchedules(opts = {}) {
  const store = opts.store || neonStore, load = opts.load || loadSchedule;
  const clock = opts.clock || Date.now, budgetMs = opts.budgetMs ?? 40000;
  const began = clock(), today = new Date(began);
  const out = { refreshed: [], fresh: 0, left: [], failed: [] };
  try { await store.prune(iso(today)); } catch (err) { console.error("schedule cache prune failed", err?.message || err); }
  let ages = new Map();
  try { ages = await store.ages(); } catch (err) { console.error("schedule cache ages failed", err?.message || err); }
  const starts = [today, ...matineeWeekOptions(today).map(w => new Date(w + "T12:00:00Z"))];
  const lane = async citySlug => {
    const todo = starts.map((start, i) => ({ start, i, age: ages.has(keyOf(citySlug, start)) ? began - ages.get(keyOf(citySlug, start)).getTime() : Infinity }))
      .filter(t => t.age >= WARM_SKIP_MS || (out.fresh++, false))
      .sort((a, b) => (b.age === a.age ? 0 : b.age > a.age ? 1 : -1) || a.i - b.i);
    for (const t of todo) {
      const k = keyOf(citySlug, t.start);
      if (clock() - began > budgetMs) { out.left.push(k); continue; }
      try { await readAndStore(citySlug, t.start, null, { store, load }); out.refreshed.push(k); }
      catch (err) { out.failed.push(`${k}: ${err?.message || err}`); }
    }
  };
  await Promise.all(["london", "new-york"].map(lane));
  return out;
}
