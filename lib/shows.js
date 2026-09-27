import { neon } from "@neondatabase/serverless";
import { CATALOGUE, CATALOGUE_VERSION } from "./catalogue.js";

// Show catalogue storage on Neon (same DATABASE_URL as shared plans).
//   shows(slug text primary key, city text, name text, data jsonb, version text, updated_at timestamptz)
// lib/catalogue.js is the source of truth that goes through review; on the first request after a
// deploy whose catalogue changed, the rows are upserted and rows no longer in the file are removed.
// If the database is unreachable the file itself is served, so the info panel never breaks.

const CITIES = new Set(["london", "broadway"]);

let sqlClient;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

let ready;
function ensureSynced() {
  if (!ready) {
    ready = (async () => {
      const db = sql();
      await db`CREATE TABLE IF NOT EXISTS shows (
        slug text PRIMARY KEY,
        city text NOT NULL,
        name text NOT NULL,
        data jsonb NOT NULL,
        version text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
      const rows = await db`SELECT count(*)::int AS n FROM shows WHERE version = ${CATALOGUE_VERSION}`;
      if (rows[0].n === CATALOGUE.length) return;
      for (const show of CATALOGUE) {
        await db`INSERT INTO shows (slug, city, name, data, version, updated_at)
                 VALUES (${show.slug}, ${show.city}, ${show.name}, ${JSON.stringify(show)}::jsonb, ${CATALOGUE_VERSION}, now())
                 ON CONFLICT (slug) DO UPDATE SET city = EXCLUDED.city, name = EXCLUDED.name,
                   data = EXCLUDED.data, version = EXCLUDED.version, updated_at = now()`;
      }
      await db`DELETE FROM shows WHERE version <> ${CATALOGUE_VERSION}`;
    })().catch(err => { ready = undefined; throw err; });
  }
  return ready;
}

export function isValidCity(city) {
  return CITIES.has(city);
}

// Returns { shows, source } where source is "database" or "file".
export async function getShows(city) {
  try {
    await ensureSynced();
    const rows = await sql()`SELECT data FROM shows WHERE city = ${city} ORDER BY name`;
    return { shows: rows.map(r => r.data), source: "database" };
  } catch (err) {
    console.error("Show catalogue: database unavailable, serving file:", err?.message || err);
    return { shows: CATALOGUE.filter(s => s.city === city), source: "file" };
  }
}
