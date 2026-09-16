import fs from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { loadPlan, isValidCode, planStats, cityShort, rangeLabel } from "../lib/plans.js";

// Generates the site's share image and app icons on demand (no binary files in the repo).
//   /api/og                  -> 1200x630 Open Graph / Twitter card image (PNG)
//   /api/og?icon=180         -> square PNG icon (favicon / apple-touch-icon / manifest)
//   /api/og?plan=abc123      -> share image for one saved itinerary (used by /plan/<code>)
// Runs on the Node runtime: satori (HTML-like element tree -> SVG) + resvg (SVG -> PNG).
// Fonts are fetched once from Google Fonts and cached in memory for the life of the instance.
// @vercel/og itself only works inside Next.js on the edge runtime, hence the direct libraries.

const require = createRequire(import.meta.url);
let wasmReady;
function ensureWasm() {
  if (!wasmReady) wasmReady = initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  return wasmReady;
}

const FONT_UA = "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:20.0) Gecko/20100101 Firefox/20.0"; // old UA -> Google serves TTF
const fontCache = new Map();
async function googleFont(family, weight) {
  const key = `${family}:${weight}`;
  if (fontCache.has(key)) return fontCache.get(key);
  const p = (async () => {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`, { headers: { "User-Agent": FONT_UA } }).then(r => r.text());
    const url = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (!url) throw new Error(`No font URL for ${family} ${weight}`);
    return Buffer.from(await fetch(url).then(r => r.arrayBuffer()));
  })();
  fontCache.set(key, p);
  p.catch(() => fontCache.delete(key));
  return p;
}
async function fonts() {
  const [serifBold, sans, sansBold] = await Promise.all([googleFont("Playfair Display", 700), googleFont("Inter", 400), googleFont("Inter", 700)]);
  return [
    { name: "serif", data: serifBold, weight: 700, style: "normal" },
    { name: "sans-serif", data: sans, weight: 400, style: "normal" },
    { name: "sans-serif", data: sansBold, weight: 700, style: "normal" }
  ];
}

async function renderPng(element, width, height) {
  await ensureWasm();
  const svg = await satori(element, { width, height, fonts: await fonts() });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
}

const INK = "#17130f";
const GOLD = "#d6a860";
const PAPER = "#fffdf8";
const CURTAIN = ["#7a1c18", "#8c2220"];

const h = (type, style, ...children) => ({ type, props: { style, children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children } });

function curtain(width, height, stripes) {
  const w = width / stripes;
  return h("div", { display: "flex", width, height },
    ...Array.from({ length: stripes }, (_, i) => h("div", { width: w, height, backgroundColor: CURTAIN[i % 2] }))
  );
}

export function shareImage() {
  return h("div", {
      width: 1200, height: 630, display: "flex", position: "relative",
      background: "linear-gradient(135deg, #17130f 0%, #35251c 100%)", color: PAPER, fontFamily: "serif"
    },
    h("div", { position: "absolute", left: 0, top: 0, display: "flex" }, curtain(150, 630, 7)),
    h("div", { position: "absolute", right: 0, top: 0, display: "flex" }, curtain(150, 630, 7)),
    h("div", { position: "absolute", left: 190, right: 190, top: 64, height: 4, backgroundColor: GOLD }),
    h("div", { position: "absolute", left: 190, right: 190, bottom: 64, height: 4, backgroundColor: GOLD }),
    h("div", { position: "absolute", left: 150, right: 150, top: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
      h("div", { fontSize: 74, fontWeight: 700, color: PAPER, marginBottom: 18, whiteSpace: "nowrap" }, "Musical Trip Planner"),
      h("div", { fontSize: 34, color: "#eadfd5", fontFamily: "sans-serif", whiteSpace: "nowrap" }, "Plan West End & Broadway shows by date"),
      h("div", { fontSize: 34, color: "#eadfd5", fontFamily: "sans-serif", marginBottom: 34, whiteSpace: "nowrap" }, "One matinee + one evening, every day of your trip"),
      h("div", { display: "flex", border: `3px solid ${GOLD}`, borderRadius: 29, padding: "12px 34px", fontSize: 26, fontWeight: 700, color: GOLD, fontFamily: "sans-serif" }, "Free  ·  Live schedules  ·  No ads"),
      h("div", { fontSize: 26, fontWeight: 700, color: GOLD, marginTop: 40, fontFamily: "sans-serif" }, "musicaltripplanner.com")
    )
  );
}

// Share image for one saved itinerary (/api/og?plan=CODE): headline + first few show names.
export function planImage(plan) {
  const { shows, names } = planStats(plan);
  const shown = names.slice(0, 4).map(n => (n.length > 34 ? n.slice(0, 33) + "…" : n));
  const more = names.length - shown.length;
  const rows = shown.map(n => h("div", { display: "flex", alignItems: "center", fontSize: 30, fontFamily: "sans-serif", color: PAPER, marginBottom: 10, whiteSpace: "nowrap" },
    h("div", { width: 10, height: 10, borderRadius: 5, backgroundColor: GOLD, marginRight: 18 }), n));
  if (more > 0) rows.push(h("div", { fontSize: 26, fontFamily: "sans-serif", color: "#cdbfb2", marginTop: 4 }, `+ ${more} more`));
  return h("div", {
      width: 1200, height: 630, display: "flex", position: "relative",
      background: "linear-gradient(135deg, #17130f 0%, #35251c 100%)", color: PAPER, fontFamily: "serif"
    },
    h("div", { position: "absolute", left: 0, top: 0, display: "flex" }, curtain(110, 630, 5)),
    h("div", { position: "absolute", right: 0, top: 0, display: "flex" }, curtain(110, 630, 5)),
    h("div", { position: "absolute", left: 150, right: 150, top: 56, height: 4, backgroundColor: GOLD }),
    h("div", { position: "absolute", left: 150, right: 150, bottom: 56, height: 4, backgroundColor: GOLD }),
    h("div", { position: "absolute", left: 150, right: 150, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 40, paddingRight: 40 },
      h("div", { fontSize: 24, fontWeight: 700, color: GOLD, fontFamily: "sans-serif", letterSpacing: 2, marginBottom: 14 }, "MY MUSICAL TRIP"),
      h("div", { fontSize: 60, fontWeight: 700, color: PAPER, marginBottom: 6, whiteSpace: "nowrap" }, `${shows} musical${shows === 1 ? "" : "s"} in ${cityShort(plan.city)}`),
      h("div", { fontSize: 34, color: "#eadfd5", fontFamily: "sans-serif", marginBottom: 30, whiteSpace: "nowrap" }, rangeLabel(plan.ranges)),
      h("div", { display: "flex", flexDirection: "column" }, ...rows),
      h("div", { fontSize: 24, fontWeight: 700, color: GOLD, marginTop: 34, fontFamily: "sans-serif" }, "Planned with musicaltripplanner.com")
    )
  );
}

export function iconImage(size) {
  const band = Math.round(size * 0.2);
  return h("div", { width: size, height: size, display: "flex", flexDirection: "column", backgroundColor: INK, borderRadius: Math.round(size * 0.22), overflow: "hidden" },
    curtain(size, band, 8),
    h("div", { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: GOLD, fontFamily: "serif", fontWeight: 700, fontSize: Math.round(size * 0.62), lineHeight: 1 }, "M")
  );
}

export default async function handler(req, res) {
  try {
    const icon = Number((req.query && req.query.icon) || 0);
    const planCode = String((req.query && req.query.plan) || "").toLowerCase();
    let element = shareImage(), w = 1200, hgt = 630;
    if (icon >= 16 && icon <= 1024) { element = iconImage(icon); w = hgt = icon; }
    else if (planCode) {
      try {
        const found = isValidCode(planCode) ? await loadPlan(planCode) : null;
        if (found) element = planImage(found.plan); // unknown code / DB trouble -> generic share image
      } catch (e) { console.error("plan lookup failed, using generic image", e); }
    }
    const png = await renderPng(element, w, hgt);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
    res.status(200).send(png);
  } catch (err) {
    console.error("og image failed", err);
    res.status(500).json({ error: String(err && err.message || err) });
  }
}
