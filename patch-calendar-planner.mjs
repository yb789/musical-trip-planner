import fs from 'node:fs';

// Calendar-first planning (2026-10-31, Yuval). See calendar-planner.js.
// 1. Generalises the per-day choice from {matinee, evening} to MH_SESSIONS
//    (morning < 12:00, matinee < 17:00, evening < 21:30, late) everywhere in the built page.
// 2. Moves the show filter into the top of the planner panel, adds the planner header with
//    "Change dates", the Calendar tab (default) and its pop-up, and inlines the new code.
// Must run LAST in build.mjs: it rewrites strings that the earlier patches produce.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('CALENDAR_PLANNER_PATCH')) { console.log('patch-calendar-planner: already applied.'); process.exit(0); }

function replaceCount(search, replacement, expected, label) {
  const n = s.split(search).length - 1;
  if (n !== expected) { console.error(`patch-calendar-planner: expected ${expected} match(es) for "${label}", found ${n}`); process.exit(1); }
  s = s.split(search).join(replacement);
}

// ---- 1. Sessions ----
const helpers = `const MH_SESSIONS=['morning','matinee','evening','late'];
function sessionOf(t){const m=mins(String(t||'0:0'));return m<720?'morning':m<1020?'matinee':m<1290?'evening':'late'}
function mhSessionLabel(k,long){return ({morning:'Morning',matinee:long?'Matinee / Afternoon':'Matinee',evening:'Evening',late:'Late evening'})[k]||k}
function mhAnySession(d){return !!d&&MH_SESSIONS.some(k=>d[k])}
function mhCountSessions(d){return d?MH_SESSIONS.filter(k=>d[k]).length:0}
function mhKeyFor(name,time){const ch=choices()[state.active]||{};return MH_SESSIONS.find(k=>ch[k]&&ch[k].name===name&&ch[k].time===time)||sessionOf(time)}
`;
const stateLine = "const state={city:'london'";
replaceCount(stateLine, helpers + stateLine, 1, 'state declaration');

replaceCount("['matinee','evening']", 'MH_SESSIONS', 9, 'session lists');
replaceCount("['matinee', 'evening']", 'MH_SESSIONS', 2, 'session lists (spaced)');
replaceCount("function commitChoice(name,time){const session=mins(time)<1020?'matinee':'evening',", "function commitChoice(name,time){const session=sessionOf(time),", 1, 'commitChoice session');
replaceCount("function attemptChoice(name,time){const session=mins(time)<1020?'matinee':'evening',", "function attemptChoice(name,time){const session=mhKeyFor(name,time),", 1, 'attemptChoice session');
replaceCount(
  "const session=mins(times[0])<1020?'matinee':'evening',sel=ch[session]&&ch[session].name===name?ch[session].time:null,",
  "const sel0=MH_SESSIONS.map(k=>ch[k]).find(c=>c&&c.name===name&&times.includes(c.time)),session=sel0?MH_SESSIONS.find(k=>ch[k]===sel0):sessionOf(times[0]),sel=sel0?sel0.time:null,",
  1, 'cards selection');
replaceCount('(ch.matinee||ch.evening)', 'mhAnySession(ch)', 2, 'day has a show');
replaceCount('(all[d].matinee||all[d].evening)', 'mhAnySession(all[d])', 1, 'checklist trip count');
replaceCount('!c.matinee&&!c.evening', '!mhAnySession(c)', 1, 'next-day open days');
replaceCount('if(!day.matinee&&!day.evening)', 'if(!mhAnySession(day))', 1, 'deselect empties day');
replaceCount('(d&&d.matinee?1:0)+(d&&d.evening?1:0)', 'mhCountSessions(d)', 1, 'saved summary count');
replaceCount('(d.matinee?1:0)+(d.evening?1:0)', 'mhCountSessions(d)', 1, 'share count');
replaceCount("d.sess==='matinee'?'Matinee':'Evening'", 'mhSessionLabel(d.sess)', 1, 'duplicate dialog label');
replaceCount("sess==='matinee'?'Matinee / Afternoon':'Evening'", 'mhSessionLabel(sess,1)', 1, 'export rows label');
replaceCount("session === 'matinee' ? 'Matinee / Afternoon' : 'Evening'", 'mhSessionLabel(session,1)', 1, 'export rows label (date-calendar)');
replaceCount("session==='matinee'?'Matinee / Afternoon':'Evening'", 'mhSessionLabel(session,1)', 1, 'confirmation rows label');
replaceCount("$(session==='matinee'?'matineeChoice':'eveningChoice')", "$(session==='morning'||session==='matinee'?'matineeChoice':'eveningChoice')", 1, 'confirmation fallback');
replaceCount("{matinee:'Matinee',evening:'Evening'}", "{morning:'Morning',matinee:'Matinee',evening:'Evening',late:'Late'}", 1, 'checklist labels');

// ---- 2. Markup ----
const asideStart = s.indexOf('<aside id="sidebar"');
const asideEnd = s.indexOf('</aside>', asideStart) + '</aside>'.length;
if (asideStart < 0 || asideEnd < asideStart) { console.error('patch-calendar-planner: sidebar not found'); process.exit(1); }
let aside = s.slice(asideStart, asideEnd);
s = s.slice(0, asideStart) + s.slice(asideEnd);
const oldNote = 'Only musicals performing on the selected date are shown. Untick any you do not want to consider.';
if (!aside.includes(oldNote)) { console.error('patch-calendar-planner: sidebar note not found'); process.exit(1); }
aside = aside.replace(oldNote, "Every show playing during your trip. Untick any you don't want to see in the calendar or the day lists.");

replaceCount(
  '<section class="planner panel"><div class="tabs"><button id="scheduleTab" class="tab active">Choose shows</button><button id="calendarTab" class="tab">My calendar</button></div><div id="scheduleView" class="schedule-view active">',
  '<section class="planner panel"><div class="pc-head"><div><b id="pcTrip">Your trip</b><div class="small">Press a slot on the calendar to see the shows playing then.</div></div><button id="pcDatesBtn" type="button">📅 Change dates</button></div>' + aside +
  '<div class="tabs"><button id="planCalTab" class="tab active" type="button">Calendar</button><button id="scheduleTab" class="tab" type="button">Day by day</button><button id="calendarTab" class="tab" type="button" hidden>My calendar</button></div>' +
  '<div id="planCalView" class="plancal-view active"><div id="planCal" class="plan-cal"></div></div><div id="scheduleView" class="schedule-view">',
  1, 'planner tabs');

// Pop-up: before the other overlays, so the duplicate / deselect confirmations open on top of it.
replaceCount(
  '<div id="duplicateOverlay" class="overlay',
  '<div id="pcOverlay" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="pcModalTitle"><div class="modal pc-modal"><div class="pc-modal-head"><div><div class="small" id="pcModalDate"></div><h2 id="pcModalTitle"></h2><div class="small" id="pcModalHint"></div></div><button id="pcClose" type="button" aria-label="Close">✕</button></div><div id="pcList"></div></div></div>\n<div id="duplicateOverlay" class="overlay',
  1, 'overlay anchor');

// Opening text now describes the calendar.
replaceCount(
  'When you are done, <b>My calendar</b> shows the whole trip at a glance and you can export it to <b>PDF or Excel</b>.',
  'The planner opens on a <b>calendar</b> of your trip: press a matinee or evening slot to see what plays then. When you are done, export your plan to <b>PDF or Excel</b>.',
  1, 'intro text');

const css = fs.readFileSync('calendar-planner.css', 'utf8');
const js = fs.readFileSync('calendar-planner.js', 'utf8');
replaceCount('</head>', `<style id="calendar-planner-css">/* CALENDAR_PLANNER_PATCH */\n${css}</style>\n</head>`, 1, 'head');
replaceCount('</body>', `<script id="calendar-planner-script">\n${js}\n</script>\n</body>`, 1, 'body');

fs.writeFileSync(file, s);
console.log('patch-calendar-planner: calendar-first planning, morning/late slots, filter at the top.');
