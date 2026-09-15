import { ImageResponse } from "@vercel/og";

// Generates the site's share image and app icons on demand (no binary files in the repo).
//   /api/og                  -> 1200x630 Open Graph / Twitter card image
//   /api/og?icon=180         -> square PNG icon (favicon / apple-touch-icon / manifest)
// Later this same function can render a per-itinerary preview (e.g. /api/og?plan=...).

export const config = { runtime: "edge" };

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

export function iconImage(size) {
  const band = Math.round(size * 0.2);
  return h("div", { width: size, height: size, display: "flex", flexDirection: "column", backgroundColor: INK, borderRadius: Math.round(size * 0.22), overflow: "hidden" },
    curtain(size, band, 8),
    h("div", { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: GOLD, fontFamily: "serif", fontWeight: 700, fontSize: Math.round(size * 0.62), lineHeight: 1 }, "M")
  );
}

export default function handler(req) {
  const { searchParams } = new URL(req.url);
  const icon = Number(searchParams.get("icon"));
  const headers = { "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000" };
  if (icon >= 16 && icon <= 1024) {
    return new ImageResponse(iconImage(icon), { width: icon, height: icon, headers });
  }
  return new ImageResponse(shareImage(), { width: 1200, height: 630, headers });
}
