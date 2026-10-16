import fs from 'node:fs';

// "Add to calendar" (.ics) button in the export panel. Inlines lib/ics.js (exports stripped,
// exposed as window.mhIcs) followed by calendar-export.js. Runs after patch-share-plan.mjs,
// which shaped the export panel buttons.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
function edit(from, to) {
  if (!s.includes(from)) { console.error('patch-ics: anchor not found: ' + from.slice(0, 80)); process.exit(1); }
  s = s.replace(from, to);
}
edit('<button id="pdfBtn" class="primary">Export to PDF</button>',
     '<button id="pdfBtn" class="primary">Export to PDF</button><button id="icsBtn" class="primary">Add to calendar</button>');
// pdf-export.js rewrites the paragraph that mentions the print dialog at runtime, so the calendar note is its own paragraph.
edit('<p class="small">PDF opens the browser print dialog; choose Save as PDF.</p>',
     '<p class="small">PDF opens the browser print dialog; choose Save as PDF.</p><p class="small"><b>Add to calendar</b> downloads an .ics file that Google Calendar, Apple Calendar and Outlook can open: one event per performance, in the theatre\'s time zone, with a reminder two hours before.</p>');
const lib = fs.readFileSync('lib/ics.js', 'utf8').replace(/^export /gm, '');
const client = fs.readFileSync('calendar-export.js', 'utf8');
const script = `<script id="ics-script">\nwindow.mhIcs=(function(){\n${lib}\nreturn {buildIcs,runtimeMinutes,DEFAULT_MINUTES};\n})();\n${client}\n</script>\n`;
s = s.replace(/\s*<script id=["']ics-script["'][\s\S]*?<\/script>\s*/gi, '\n');
s = s.replace('</body>', script + '</body>');
fs.writeFileSync(file, s);
console.log('patch-ics: Add to calendar (.ics) button and script.');
