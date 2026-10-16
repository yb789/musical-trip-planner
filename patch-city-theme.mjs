import fs from 'node:fs';

// Different page colours per city (2026-10-16, requested by Yuval), so a visitor never mixes up
// London and New York. London keeps the warm cream theme; New York / Broadway gets a cool
// blue-grey page, a navy header and a navy accent. The city is written to <body data-city="…">
// whenever a schedule loads (city switch, start screen, ?city= deep link, restored session),
// via setLoading(), which both loadSchedule implementations (index.html, date-calendar.js) call.
// Runs last in build.mjs.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('CITY_THEME_PATCH')) { console.log('patch-city-theme: already applied.'); process.exit(0); }

function mustReplace(search, replacement, label) {
  const n = s.split(search).length - 1;
  if (n !== 1) { console.error(`patch-city-theme: expected one match for "${label}", found ${n}`); process.exit(1); }
  s = s.replace(search, () => replacement);
}

// 1. Tag the body with the city each time a schedule is loaded. Hooked into setLoading(), which
//    both loadSchedule implementations call first (date-calendar.js overrides loadSchedule at runtime).
mustReplace(
  'function setLoading(on,msg=\'\'){',
  'function setLoading(on,msg=\'\'){document.body.dataset.city=state.city;/* CITY_THEME_PATCH */',
  'setLoading'
);

// 1b. Opening screen (show-helper welcome, inlined by patch-show-helper.mjs): the city buttons
//     there set hs.city and re-render, so tagging the body in renderWelcome() recolours the page
//     and the overlay (which uses var(--bg)) immediately. The city <select> on the date dialog is
//     handled by a delegated listener, because date-calendar.js rebuilds that dialog at runtime.
mustReplace(
  'function renderWelcome() {',
  'function renderWelcome() {document.body.dataset.city=hs.city;',
  'renderWelcome'
);
mustReplace(
  "$('continueBtn').onclick=startPlanning;",
  "$('continueBtn').onclick=startPlanning;document.addEventListener('change',e=>{if(e.target&&e.target.id==='startCity')document.body.dataset.city=e.target.value});",
  'startCity change'
);

// 2. Broadway palette: overrides the :root tokens, the header gradient and the few hard-coded warm tints.
mustReplace(
  '--shadow:0 12px 35px rgba(30,25,20,.08)}',
  '--shadow:0 12px 35px rgba(30,25,20,.08)}' +
  'body[data-city="broadway"]{--bg:#e6edf6;--paper:#fbfcfe;--line:#c7d2e0;--accent:#1d3f73;--shadow:0 12px 35px rgba(20,35,60,.10)}' +
  'body[data-city="broadway"] header,body[data-city="broadway"] .mh-top{background:linear-gradient(135deg,#0b1526,#1c3458)}' +
  'body[data-city="broadway"] header p{color:#d6e0ee}' +
  'body[data-city="broadway"] .badge{border-color:#4d6487;color:#e4ecf7}' +
  'body[data-city="broadway"] .time{background:#e9f0fa}' +
  'body[data-city="broadway"] .ticket-link:not(.tm-link){background:#7c2d12}' +
  'body,.mh-overlay{transition:background-color .35s}header,.mh-top{transition:background .35s}',
  'root tokens'
);

fs.writeFileSync(file, s);
console.log('patch-city-theme: Broadway gets a blue page theme, London keeps the cream one.');
