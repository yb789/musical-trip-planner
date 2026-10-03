import { validateFeedback, submitFeedback, originAllowed } from "../lib/feedback.js";

// POST /api/feedback  body: {topic, message, email?, page?, website(honeypot)}  -> {ok:true}
// Used by the form on /about/. See lib/feedback.js for storage and email.
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!originAllowed(req.headers.origin)) return res.status(403).json({ error: "Please use the form on musicaltripplanner.com/about/" });
  const len = Number(req.headers["content-length"] || 0);
  if (len > 16_000) return res.status(413).json({ error: "Message too long" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const v = validateFeedback(body);
  // Bots that fill the hidden field get a normal-looking success and nothing is stored.
  if (v.spam) return res.status(200).json({ ok: true });
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
    const r = await submitFeedback(v.value, ip);
    if (r.limited) return res.status(429).json({ error: "Thanks! You've sent several messages just now. Please try again in a few minutes." });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("feedback failed", err);
    return res.status(500).json({ error: "Sorry, the message couldn't be sent. Please email info@musicaltripplanner.com instead." });
  }
}
