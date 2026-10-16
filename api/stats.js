import { stats } from "../lib/events.js";

// GET /api/stats?days=30   Authorization: Bearer <CRON_SECRET>   -> usage totals as JSON
// Same secret as the guide check, so nothing new to configure.
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  const auth = req.headers.authorization || "";
  const key = (req.query && req.query.key) || "";
  if (auth !== `Bearer ${secret}` && key !== secret) return res.status(401).json({ error: "Unauthorized" });
  try {
    return res.status(200).json(await stats(req.query && req.query.days));
  } catch (err) {
    console.error("stats failed", err);
    return res.status(500).json({ error: "Stats unavailable" });
  }
}
