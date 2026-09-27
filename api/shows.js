import { getShows, isValidCity } from "../lib/shows.js";

// GET /api/shows?city=london|broadway -> { city, shows: [...] }
// Public, read-only: the catalogue is our own content (original descriptions + checked facts).
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") {
    res.status(405);
    return res.end(JSON.stringify({ error: "GET only" }));
  }
  const city = String(req.query.city || "").toLowerCase();
  if (!isValidCity(city)) {
    res.status(400);
    return res.end(JSON.stringify({ error: "city must be london or broadway" }));
  }
  const { shows } = await getShows(city);
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.status(200);
  res.end(JSON.stringify({ city, shows }));
}
