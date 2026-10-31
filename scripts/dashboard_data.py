#!/usr/bin/env python3
"""Turn the daily stats email into the dashboard's data files.

The site emails a daily report to info@ (lib/daily-report.js, cron /api/stats?report=daily).
Its plain-text body holds the full data as JSON between the lines MTP-DATA-BEGIN and MTP-DATA-END.

Usage:
    python3 scripts/dashboard_data.py REPORT OUT_DIR

REPORT is either that JSON or the whole email text (the markers are found automatically).
Writes one JSON file per dashboard dataset into OUT_DIR (an array of row objects each) and prints
their names. Only the Python standard library is used.
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

COUNTRIES = {
    "GB": "United Kingdom", "GBR": "United Kingdom", "US": "United States", "USA": "United States",
    "IL": "Israel", "ISR": "Israel", "CA": "Canada", "CAN": "Canada", "AU": "Australia", "AUS": "Australia",
    "IE": "Ireland", "IRL": "Ireland", "DE": "Germany", "DEU": "Germany", "FR": "France", "FRA": "France",
    "NL": "Netherlands", "NLD": "Netherlands", "BE": "Belgium", "BEL": "Belgium", "ES": "Spain", "ESP": "Spain",
    "IT": "Italy", "ITA": "Italy", "CH": "Switzerland", "CHE": "Switzerland", "AT": "Austria", "AUT": "Austria",
    "SE": "Sweden", "SWE": "Sweden", "NO": "Norway", "NOR": "Norway", "DK": "Denmark", "DNK": "Denmark",
    "FI": "Finland", "FIN": "Finland", "PL": "Poland", "POL": "Poland", "PT": "Portugal", "PRT": "Portugal",
    "NZ": "New Zealand", "NZL": "New Zealand", "IN": "India", "IND": "India", "BR": "Brazil", "BRA": "Brazil",
    "MX": "Mexico", "MEX": "Mexico", "AR": "Argentina", "ARG": "Argentina", "AE": "United Arab Emirates",
    "ARE": "United Arab Emirates", "SG": "Singapore", "SGP": "Singapore", "JP": "Japan", "JPN": "Japan",
    "CN": "China", "CHN": "China", "ZA": "South Africa", "ZAF": "South Africa", "CY": "Cyprus", "CYP": "Cyprus",
    "GR": "Greece", "GRC": "Greece", "BG": "Bulgaria", "BGR": "Bulgaria", "AM": "Armenia", "ARM": "Armenia",
    "BD": "Bangladesh", "BGD": "Bangladesh", "BS": "Bahamas", "BHS": "Bahamas", "CL": "Chile", "CHL": "Chile",
    "CO": "Colombia", "COL": "Colombia", "AO": "Angola", "AGO": "Angola", "PH": "Philippines", "PHL": "Philippines",
}
EVENT_LABELS = {
    "dates_chosen": "Chose trip dates", "finished": "Finished a plan", "export_pdf": "Exported PDF",
    "export_excel": "Exported Excel", "export_ics": "Added to calendar", "share_open": "Opened Share",
    "share_created": "Created a share link", "plan_opened": "Opened a shared plan",
    "ticket_click": "Clicked a ticket button", "booked_marked": "Marked a show as booked",
    "kind_toggle": "Changed show types",
}


def country(code):
    c = str(code or "").upper()
    return COUNTRIES.get(c, c or "Unknown")


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _find_text(obj):
    """Find the string that holds the markers inside parsed JSON (e.g. a saved Gmail tool result)."""
    if isinstance(obj, str):
        if obj.lstrip().startswith(("{", "[")):
            try:
                return _find_text(json.loads(obj))
            except ValueError:
                pass
        return obj if "MTP-DATA-BEGIN" in obj else None
    items = obj.values() if isinstance(obj, dict) else obj if isinstance(obj, list) else []
    for v in items:
        t = _find_text(v)
        if t:
            return t
    return None


def load(path):
    text = Path(path).read_text(encoding="utf-8")
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict) and parsed.get("kind") == "mtp-daily":
            return parsed
        text = _find_text(parsed) or text
    except ValueError:
        pass
    m = re.search(r"MTP-DATA-BEGIN\s*(\{.*\})\s*MTP-DATA-END", text, re.S)
    if not m:
        sys.exit("No MTP-DATA-BEGIN ... MTP-DATA-END block found")
    return json.loads(m.group(1))


def build(r):
    site, impact, gsc = r.get("site") or {}, r.get("impact") or {}, r.get("gsc") or {}
    pv = site.get("pageviews") or {}
    reports = impact.get("reports") or {}
    out = {}

    out["site_daily"] = [{"day": d["day"], "views": d["views"], "visitors": d["visitors"]} for d in pv.get("byDay", [])]
    out["site_countries"] = [{"country": country(c["country"]), "visitors": c["visitors"], "views": c["views"]}
                             for c in pv.get("byCountry", [])]
    out["site_pages"] = [{"page": p["page"], "views": p["views"], "visitors": p["visitors"]} for p in pv.get("byPage", [])[:20]]
    out["site_referrers"] = [{"site": p["ref"], "views": p["views"]} for p in pv.get("byReferrer", [])]
    out["planner_actions"] = [{"action": EVENT_LABELS.get(e["event"], e["event"]), "times": e["n"], "visitors": e["visitors"]}
                              for e in site.get("byEvent", []) if e["event"] not in ("pageview", "go_click", "go_bot")]

    people, bots = {}, {}
    for g in (site.get("goClicks") or {}).get("bySource", []):
        key = {"seatplan": "SeatPlan", "ticketmaster": "Ticketmaster"}.get(g.get("seller"), g.get("seller") or "?")
        (people if g["event"] == "go_click" else bots)[key] = (people if g["event"] == "go_click" else bots).get(key, 0) + g["n"]
    out["go_clicks"] = [{"seller": s, "people": people.get(s, 0), "bots": bots.get(s, 0)} for s in sorted(set(people) | set(bots))]
    out["go_shows"] = [{"source": s["show"] or "(none)", "clicks": s["n"]} for s in (site.get("goClicks") or {}).get("byShow", [])]

    out["gsc_daily"] = [{"day": d["date"], "impressions": d["impressions"], "clicks": d["clicks"], "position": round(d["position"], 1)}
                        for d in gsc.get("byDate", [])]
    out["gsc_queries"] = [{"query": q["query"], "impressions": q["impressions"], "clicks": q["clicks"], "position": round(q["position"], 1)}
                          for q in gsc.get("byQuery", [])]
    out["gsc_pages"] = [{"page": re.sub(r"^https?://[^/]+", "", p["page"]) or "/", "impressions": p["impressions"], "clicks": p["clicks"],
                         "position": round(p["position"], 1)} for p in gsc.get("byPage", [])]
    out["gsc_countries"] = [{"country": country(c["country"]), "impressions": c["impressions"], "clicks": c["clicks"]}
                            for c in gsc.get("byCountry", [])]

    daily = []
    for rec in (reports.get("byDay") or {}).get("records", []):
        try:
            day = datetime.strptime(rec.get("date_display", ""), "%b %d, %Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
        daily.append({"day": day, "clicks": int(num(rec.get("Clicks"))), "sales": int(num(rec.get("Actions"))),
                      "commission": round(num(rec.get("Total_Cost")), 2)})
    out["impact_daily"] = sorted(daily, key=lambda d: d["day"])
    out["impact_brands"] = [{"programme": b.get("Campaign", ""), "clicks": int(num(b.get("Clicks"))), "sales": int(num(b.get("Actions"))),
                             "commission": round(num(b.get("Total_Cost")), 2)} for b in (reports.get("byBrand") or {}).get("records", [])]
    subs = {}
    for s in (reports.get("bySubId") or {}).get("records", []):
        k = s.get("pubsubid1_") or "(none)"
        o = subs.setdefault(k, {"source": k, "programmes": set(), "clicks": 0, "sales": 0, "commission": 0.0})
        o["programmes"].add(s.get("Campaign", ""))
        o["clicks"] += int(num(s.get("raw_clicks") or s.get("Clicks")))
        o["sales"] += int(num(s.get("Actions")))
        o["commission"] += num(s.get("Earnings"))
    out["impact_sources"] = sorted(({**o, "programmes": ", ".join(sorted(p for p in o["programmes"] if p)), "commission": round(o["commission"], 2)}
                                    for o in subs.values()), key=lambda o: (-o["commission"], -o["clicks"]))[:25]

    a = impact.get("actions") or {}
    gt = gsc.get("total") or {}
    out["kpi"] = [{
        "report_date": r.get("date", ""),
        "page_views_30d": (pv.get("total") or {}).get("views", 0),
        "visitor_days_30d": sum(d["visitors"] for d in out["site_daily"]),
        "go_people_30d": sum(people.values()), "go_bots_30d": sum(bots.values()),
        "gsc_impressions": gt.get("impressions", 0), "gsc_clicks": gt.get("clicks", 0),
        "gsc_position": round(gt.get("position", 0) or 0, 1),
        "impact_clicks_30d": sum(b["clicks"] for b in out["impact_brands"]),
        "impact_sales_30d": a.get("count", 0), "impact_commission_30d": round(a.get("payout", 0) or 0, 2),
        "currency": "/".join(a.get("currencies") or []) or "ILS",
        "errors": "; ".join(f"{k}: {v['error']}" for k, v in (("site", site), ("impact", impact), ("search console", gsc))
                            if isinstance(v, dict) and v.get("error")) or "none",
    }]
    return out


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    data = build(load(sys.argv[1]))
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    for name, rows in data.items():
        (out / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{name}.json\t{len(rows)} rows")


if __name__ == "__main__":
    main()
