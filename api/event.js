import { normalizeEvent, storeEvent } from "../lib/events.js";

// POST /api/event  body: {event, page, city, seller, show}  (sent with navigator.sendBeacon)
// Always answers 204 so a browser never sees an error; bad or over-quota events are dropped.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end(); }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const ev = normalizeEvent(body);
  if (!ev) return res.status(204).end();
  try {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "";
    await storeEvent(ev, ip);
  } catch (err) {
    console.error("event store failed", err);
  }
  return res.status(204).end();
}
