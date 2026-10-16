// iCalendar (.ics) export of chosen performances. Used by the planner (inlined into the page
// by patch-ics.mjs, which strips the `export` keywords) and by /api/plan-ics for shared plans.
// Each performance becomes one VEVENT in the theatre's local time zone, so a visitor's
// calendar app shows 19:30 London as 19:30 London wherever they are.

const TZ = {
  london: { id: "Europe/London", vtimezone:
`BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE` },
  broadway: { id: "America/New_York", vtimezone:
`BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE` }
};

export const DEFAULT_MINUTES = 150;

// "2h 45m, 1 interval" -> 165; "1h 20m, no interval" -> 80; "Part One 2h 40m, Part Two 2h 35m" with
// part "Part Two" -> 155. Unknown -> DEFAULT_MINUTES.
export function runtimeMinutes(runtime, part) {
  const s = String(runtime || "");
  let seg = s;
  if (part && /part/i.test(s)) {
    const m = s.match(new RegExp(part + "[^,;]*", "i"));
    if (m) seg = m[0];
  }
  const h = seg.match(/(\d+)\s*h/i), m = seg.match(/(\d+)\s*m(?:in)?/i);
  const total = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  return total > 0 ? total : DEFAULT_MINUTES;
}

function pad(n) { return String(n).padStart(2, "0"); }
function localStamp(date, time) {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return `${y}${pad(mo)}${pad(d)}T${pad(hh)}${pad(mm)}00`;
}
function addMinutes(date, time, minutes) {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, hh, mm) + minutes * 60000);
  return { date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`, time: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}` };
}
function escText(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, c => "\\" + c);
}
function fold(line) {
  // RFC 5545: lines at most 75 octets, continuation lines start with a space.
  const out = [];
  let cur = "";
  for (const ch of line) {
    const bytes = new TextEncoder().encode(cur + ch).length;
    if (bytes > 74) { out.push(cur); cur = " " + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n");
}
function utcNow() {
  const t = new Date();
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}Z`;
}

// events: [{date:"2026-11-11", time:"19:30", name, part, venue, address, url, minutes}]
export function buildIcs({ city, name = "Musical Trip Planner", events }) {
  const tz = TZ[city] || TZ.london;
  const stamp = utcNow();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Musical Trip Planner//musicaltripplanner.com//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escText(name)}`,
    `X-WR-TIMEZONE:${tz.id}`,
    ...tz.vtimezone.split("\n")
  ];
  let i = 0;
  for (const ev of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || "") || !/^\d{2}:\d{2}$/.test(ev.time || "")) continue;
    const minutes = Number(ev.minutes) > 0 ? Number(ev.minutes) : DEFAULT_MINUTES;
    const end = addMinutes(ev.date, ev.time, minutes);
    const title = ev.name + (ev.part ? ` — ${ev.part}` : "");
    const desc = [
      ev.part ? "Two-part play: Part One and Part Two are separate tickets; you need both to see the whole story." : "",
      ev.url ? `Tickets: ${ev.url}` : "",
      "Planned with Musical Trip Planner — https://musicaltripplanner.com"
    ].filter(Boolean).join("\n");
    const location = [ev.venue, ev.address].filter(Boolean).join(", ");
    i++;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${ev.date.replace(/-/g, "")}T${ev.time.replace(":", "")}-${i}-${stamp}@musicaltripplanner.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz.id}:${localStamp(ev.date, ev.time)}`,
      `DTEND;TZID=${tz.id}:${localStamp(end.date, end.time)}`,
      `SUMMARY:${escText(title)}`,
      location ? `LOCATION:${escText(location)}` : "",
      `DESCRIPTION:${escText(desc)}`,
      ev.url ? `URL:${ev.url}` : "",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escText(title)} starts in 2 hours`,
      "TRIGGER:-PT2H",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.filter(Boolean).map(fold).join("\r\n") + "\r\n";
}
