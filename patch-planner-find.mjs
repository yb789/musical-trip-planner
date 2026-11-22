import fs from 'node:fs';

// "Find a show" inside the planner (22 Nov 2026, Yuval). See planner-find.js.
// Puts the box at the top of the planner panel, under the trip header and above the show filter,
// and inlines its code and styles. Runs after patch-calendar-planner.mjs, which builds that header.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('PLANNER_FIND_PATCH')) { console.log('patch-planner-find: already applied.'); process.exit(0); }

const anchor = '<button id="pcDatesBtn" type="button">📅 Change dates</button></div>';
if (s.split(anchor).length !== 2) { console.error('patch-planner-find: planner header not found'); process.exit(1); }
const box = '<div id="pfBox" class="pf" hidden><label class="pf-label" for="pfInput">Find a show on your dates</label>' +
  '<div class="pf-field"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
  '<input id="pfInput" type="search" placeholder="Type a name: Hamilton, Wicked…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="60"><button id="pfClear" type="button" aria-label="Clear the search">Clear</button></div>' +
  '<p id="pfHint" class="pf-hint" hidden>The days it plays are outlined on the calendar below.</p>' +
  '<div id="pfResults" class="pf-results" hidden></div><div id="pfStatus" class="pf-sr" role="status" aria-live="polite"></div></div>';
s = s.replace(anchor, anchor + box);

const css = fs.readFileSync('planner-find.css', 'utf8');
const js = fs.readFileSync('planner-find.js', 'utf8');
if (!s.includes('</head>') || !s.includes('</body>')) { console.error('patch-planner-find: page skeleton not found'); process.exit(1); }
s = s.replace('</head>', `<style id="planner-find-style">\n${css}\n</style>\n</head>`);
s = s.replace('</body>', `<script id="planner-find-script">\n/* PLANNER_FIND_PATCH */\n${js}\n</script>\n</body>`);
fs.writeFileSync(file, s);
console.log('patch-planner-find: "Find a show" box added to the planner.');
