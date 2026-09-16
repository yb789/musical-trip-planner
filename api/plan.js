import { SITE, normalizePlan, storePlan, loadPlan, isValidCode, planTitle } from "../lib/plans.js";

// Shareable itineraries.
//   POST /api/plan   body: {city, ranges:[{start,end}], choices:{date:{matinee,evening}}}  -> {code, url}
//   GET  /api/plan?code=abc123                                                          -> {code, plan, createdAt}
// The read-only page lives at /plan/<code> (api/plan-page.js) and the planner imports with /?plan=<code>.

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
      let plan;
      try { plan = normalizePlan(body); } catch (e) { return res.status(400).json({ error: e.message }); }
      const code = await storePlan(plan);
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({ code, url: `${SITE}/plan/${code}`, title: planTitle(plan) });
    }
    if (req.method === "GET") {
      const code = String((req.query && req.query.code) || "").toLowerCase();
      if (!isValidCode(code)) return res.status(400).json({ error: "Invalid plan code" });
      const found = await loadPlan(code);
      if (!found) { res.setHeader("Cache-Control", "no-store"); return res.status(404).json({ error: "Plan not found" }); }
      res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
      return res.status(200).json({ code, plan: found.plan, createdAt: found.createdAt, title: planTitle(found.plan) });
    }
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("plan api failed", err);
    return res.status(500).json({ error: "Plan service unavailable" });
  }
}
