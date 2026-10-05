import { runGuideCheck, emailReport, summaryLine } from "../lib/guide-check.js";

// Weekly guide check (Vercel cron, see vercel.json "crons"). Compares the show guide with the
// live schedule, SeatPlan and Ticketmaster and emails the report to info@ via Resend.
// Protected by CRON_SECRET: Vercel sends "Authorization: Bearer <CRON_SECRET>" with every cron call,
// and the dashboard's "Run" button (Settings -> Cron Jobs) does the same.
// ?send=0 returns the report as JSON without emailing (still needs the secret).
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "CRON_SECRET is not configured" });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  try {
    const report = await runGuideCheck();
    let emailed = false, emailError = "";
    if (req.query?.send !== "0") {
      try { emailed = await emailReport(report); } catch (err) { emailError = String(err?.message || err); console.error("guide check email failed", emailError); }
    }
    console.log("guide check", summaryLine(report), emailed ? "emailed" : "not emailed");
    return res.status(200).json({ ok: true, summary: summaryLine(report), emailed, emailError, report });
  } catch (err) {
    console.error("guide check failed", err);
    return res.status(500).json({ error: "Guide check failed" });
  }
}
