import fs from 'node:fs';

// "Next day" button beside Finish planning (2026-10-30, Yuval). See next-day.js.
// Runs after patch-booking-checklist.mjs (which sets the finish-bar hint text).

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('NEXT_DAY_PATCH')) { console.log('patch-next-day: already applied.'); process.exit(0); }

function mustReplace(search, replacement, label) {
  const n = s.split(search).length - 1;
  if (n !== 1) { console.error(`patch-next-day: expected one match for "${label}", found ${n}`); process.exit(1); }
  s = s.replace(search, () => replacement);
}

mustReplace(
  '<div class="finish-bar"><div class="small">Done choosing? Book your tickets, export or share your plan.</div><button id="finishBtn" class="primary">Finish planning</button></div>',
  '<div class="finish-bar"><div class="small" id="finishHint">Done choosing? Book your tickets, export or share your plan.</div><div class="finish-actions"><div id="nextDayWrap" class="next-day"></div><button id="finishBtn" class="primary">Finish planning</button></div></div>',
  'finish bar'
);

const css = fs.readFileSync('next-day.css', 'utf8');
const js = fs.readFileSync('next-day.js', 'utf8');
mustReplace('</head>', `<style id="next-day-css">/* NEXT_DAY_PATCH */\n${css}</style>\n</head>`, 'head');
s = s.replace('</body>', `<script id="next-day-script">\n${js}\n</script>\n</body>`);

fs.writeFileSync(file, s);
console.log('patch-next-day: Next day button in the finish bar.');
