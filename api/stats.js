import { stats } from "../lib/events.js";
import { buildDailyReport, emailDailyReport, summaryLines } from "../lib/daily-report.js";
import { buildSeoReport, emailSeoReport } from "../lib/seo-report.js";
import { runLinkCheck } from "../lib/link-check.js";

// GET /api/stats?days=30   Authorization: Bearer <CRON_SECRET>   -> usage totals as JSON
// Same secret as the guide check, so nothing new to configure.
// GET /api/stats?report=daily  -> daily report (site + Impact + Search Console), emailed to info@
//   (Vercel cron, see vercel.json); add &send=0 to get the JSON without emailing. lib/daily-report.js
//   On Mondays (UTC) the same cron run also sends the weekly SEO report (no extra cron slot needed).
// GET /api/stats?report=seo    -> weekly SEO report (Search Console query x page, 28 days vs the 28
//   before), stored in Neon gsc_weekly and emailed; &send=0 returns the JSON only. lib/seo-report.js
// GET /api/stats?report=links  -> nightly ticket-link check (Vercel cron, before the daily report):
//   opens the planner's SeatPlan date links and checks the Ticketmaster event links, stores the result
//   in Neon link_checks (read by the daily email and by /go's fallback); &store=0 = dry run. lib/link-check.js
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  const auth = req.headers.authorization || "";
  const key = (req.query && req.query.key) || "";
  if (auth !== `Bearer ${secret}` && key !== secret) return res.status(401).json({ error: "Unauthorized" });
  if (req.query && req.query.report === "seo") {
    try {
      const report = await buildSeoReport({ store: req.query.store !== "0" });
      let emailed = false, emailError = "";
      if (req.query.send !== "0") {
        try { emailed = await emailSeoReport(report); } catch (err) { emailError = String(err?.message || err); console.error("seo report email failed", emailError); }
      }
      return res.status(200).json({ ok: !report.error, emailed, emailError, report });
    } catch (err) {
      console.error("seo report failed", err);
      return res.status(500).json({ error: "SEO report failed" });
    }
  }
  if (req.query && req.query.report === "links") {
    try {
      const report = await runLinkCheck({ store: req.query.store !== "0" });
      console.log("link check", JSON.stringify(report.counts), report.failures.length, "failed", report.errors.join("; "));
      return res.status(200).json({ ok: true, report });
    } catch (err) {
      console.error("link check failed", err);
      return res.status(500).json({ error: "Link check failed" });
    }
  }
  if (req.query && req.query.report === "daily") {
    try {
      const report = await buildDailyReport();
      let emailed = false, emailError = "";
      if (req.query.send !== "0") {
        try { emailed = await emailDailyReport(report); } catch (err) { emailError = String(err?.message || err); console.error("daily report email failed", emailError); }
      }
      console.log("daily report", summaryLines(report).join(" | "), emailed ? "emailed" : "not emailed");
      // Weekly SEO report on Mondays, after the daily one; its failure never affects the daily report.
      let seo = null;
      if (new Date().getUTCDay() === 1 && req.query.send !== "0") {
        try {
          const sr = await buildSeoReport();
          seo = { ok: !sr.error, error: sr.error || "", emailed: await emailSeoReport(sr) };
        } catch (err) { seo = { ok: false, error: String(err?.message || err) }; console.error("weekly seo report failed", seo.error); }
      }
      return res.status(200).json({ ok: true, emailed, emailError, seo, report });
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
