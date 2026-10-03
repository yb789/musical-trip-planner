import { neon } from "@neondatabase/serverless";
import { createHash } from "node:crypto";

// Feedback from the About page form.
// Stored in Neon (env DATABASE_URL), table created on first use:
//   feedback(id serial, created_at timestamptz, topic text, message text, email text, page text, ip_hash text, emailed boolean)
// Read it in the Neon console:  SELECT created_at, topic, email, message FROM feedback ORDER BY created_at DESC;
// Optionally also emailed through Resend (env RESEND_API_KEY). Without the key, messages are only stored.
//   FEEDBACK_TO   default info@musicaltripplanner.com
//   FEEDBACK_FROM default "Musical Trip Planner <feedback@musicaltripplanner.com>" (the domain must be verified in Resend)

export const TOPICS = { wrong: "Wrong or missing show / time", idea: "Idea or feature request", bug: "Something doesn't work", other: "Other" };
const MAX_MESSAGE = 4000;
const MAX_PER_10_MIN = 5;
const ALLOWED_ORIGINS = ["https://musicaltripplanner.com", "https://www.musicaltripplanner.com"];

let sqlClient;
function sql() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

let tableReady;
function ensureTable(db) {
  if (!tableReady) {
    tableReady = db`CREATE TABLE IF NOT EXISTS feedback (
      id serial PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      topic text NOT NULL,
      message text NOT NULL,
      email text NOT NULL DEFAULT '',
      page text NOT NULL DEFAULT '',
      ip_hash text NOT NULL DEFAULT '',
      emailed boolean NOT NULL DEFAULT false
    )`.catch(err => { tableReady = undefined; throw err; });
  }
  return tableReady;
}

// Same-site check: the form posts from our own pages (production or a Vercel preview).
export function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
}

const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i;

// Returns { ok:true, value } or { ok:false, error }. A filled honeypot is reported as spam.
export function validateFeedback(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid request" };
  if (typeof body.website === "string" && body.website.trim()) return { ok: false, error: "spam", spam: true };
  const topic = Object.hasOwn(TOPICS, body.topic) ? body.topic : "other";
  const message = typeof body.message === "string" ? body.message.replace(/\r\n/g, "\n").trim() : "";
  if (message.length < 5) return { ok: false, error: "Please write a few words." };
  if (message.length > MAX_MESSAGE) return { ok: false, error: `Please keep it under ${MAX_MESSAGE} characters.` };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email && (email.length > 254 || !EMAIL.test(email))) return { ok: false, error: "That email address doesn't look right." };
  const page = typeof body.page === "string" ? body.page.slice(0, 300) : "";
  return { ok: true, value: { topic, message, email, page } };
}

export function hashIp(ip) {
  const salt = process.env.FEEDBACK_SALT || "musical-trip-planner-feedback";
  return createHash("sha256").update(salt + "|" + String(ip || "")).digest("hex").slice(0, 32);
}

const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function sendEmail(fb, fetchImpl) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const to = process.env.FEEDBACK_TO || "info@musicaltripplanner.com";
  const from = process.env.FEEDBACK_FROM || "Musical Trip Planner <feedback@musicaltripplanner.com>";
  const payload = {
    from, to: [to],
    subject: `Feedback: ${TOPICS[fb.topic]}`,
    text: `${fb.message}\n\nTopic: ${TOPICS[fb.topic]}\nFrom: ${fb.email || "(no email given)"}\nPage: ${fb.page || "-"}`,
    html: `<p style="white-space:pre-wrap">${escHtml(fb.message)}</p><hr><p>Topic: ${escHtml(TOPICS[fb.topic])}<br>From: ${escHtml(fb.email || "(no email given)")}<br>Page: ${escHtml(fb.page || "-")}</p>`
  };
  if (fb.email) payload.reply_to = fb.email;
  const r = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
  return true;
}

// Stores the message, then tries to email it. Email failure never loses the message.
// Returns { stored, emailed, limited }.
export async function submitFeedback(fb, ip, { db = sql(), fetchImpl = fetch } = {}) {
  await ensureTable(db);
  const ipHash = hashIp(ip);
  const recent = await db`SELECT count(*)::int AS n FROM feedback WHERE ip_hash = ${ipHash} AND created_at > now() - interval '10 minutes'`;
  if ((recent[0]?.n || 0) >= MAX_PER_10_MIN) return { stored: false, emailed: false, limited: true };
  const rows = await db`INSERT INTO feedback (topic, message, email, page, ip_hash) VALUES (${fb.topic}, ${fb.message}, ${fb.email}, ${fb.page}, ${ipHash}) RETURNING id`;
  let emailed = false;
  try { emailed = await sendEmail(fb, fetchImpl); } catch (err) { console.error("feedback email failed", err?.message || err); }
  if (emailed) await db`UPDATE feedback SET emailed = true WHERE id = ${rows[0].id}`;
  return { stored: true, emailed, limited: false };
}
