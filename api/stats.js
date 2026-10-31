import { stats } from "../lib/events.js";
import { buildDailyReport, emailDailyReport, summaryLines } from "../lib/daily-report.js";

// GET /api/stats?days=30   Authorization: Bearer <CRON_SECRET>   -> usage totals as JSON
// Same secret as the guide check, so nothing new to configure.
// GET /api/stats?report=daily  -> daily report (site + Impact + Search Console), emailed to info@
//   (Vercel cron, see vercel.json); add &send=0 to get the JSON without emailing. lib/daily-report.js
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  const auth = req.headers.authorization || "";
  const key = (req.query && req.query.key) || "";
  if (auth !== `Bearer ${secret}` && key !== secret) return res.status(401).json({ error: "Unauthorized" });
  if (req.query && req.query.report === "daily") {
    try {
      const report = await buildDailyReport();
      let emailed = false, emailError = "";
      if (req.query.send !== "0") {
        try { emailed = await emailDailyReport(report); } catch (err) { emailError = String(err?.message || err); console.error("daily report email failed", emailError); }
      }
      console.log("daily report", summaryLines(report).join(" | "), emailed ? "emailed" : "not emailed");
      return res.status(200).json({ ok: true, emailed, emailError, report });
    } catch (err) {
      console.error("daily report failed", err);
      return res.status(500).json({ error: "Daily report failed" });
    }
  }
  try {
    return res.status(200).json(await stats(req.query && req.query.days));
  } catch (err) {
    console.error("stats failed", err);
    return res.status(500).json({ error: "Stats unavailable" });
  }
}
