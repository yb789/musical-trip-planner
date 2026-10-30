import fs from 'node:fs';

// "Book your tickets" checklist (2026-10-30, after visitor feedback that the big ticket buttons on the
// chosen card looked like part of planning and that the ticket site pulled him away mid-plan).
// - Chosen card: the SeatPlan / Ticketmaster blocks are replaced by a small "Buy tickets ↗" link that
//   opens a "Leaving the planner" dialog (booking-checklist.js, window.mhBuyLinkHtml).
// - Finish planning panel: a checklist of every chosen performance with seller buttons and
//   "Mark as booked"; exports/share/calendar stay below it.
// - Deselecting a show marked as booked asks first, like one with a confirmation attached.
// Runs last in build.mjs. Inlines booking-checklist.css and booking-checklist.js.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('BOOKING_CHECKLIST_PATCH')) { console.log('patch-booking-checklist: already applied.'); process.exit(0); }

function mustReplace(search, replacement, label) {
  const n = s.split(search).length - 1;
  if (n !== 1) { console.error(`patch-booking-checklist: expected one match for "${label}", found ${n}`); process.exit(1); }
  s = s.replace(search, () => replacement);
}

// 1. Chosen card: small link instead of the seller blocks.
mustReplace(
  '${on?`<div class="card-links">${linkHtml(ch[session])}</div>`:\'\'}',
  '${on?`<div class="card-links">${typeof window.mhBuyLinkHtml===\'function\'?window.mhBuyLinkHtml(ch[session],state.active,session):linkHtml(ch[session])}</div>`:\'\'}',
  'card links'
);

// 2. Finish planning panel: the checklist above the export buttons.
mustReplace(
  '<div id="exportPanel" class="hidden"><h2>Your schedule is ready</h2><p>Export your selected schedule.</p><div class="actions">',
  '<div id="exportPanel" class="hidden"><h2>Your plan is ready</h2><h3>Book your tickets</h3><p class="book-intro">Each ticket site opens in a new tab, and your plan stays saved here. Come back and tick off each show as you book it.</p><div id="bookList"></div><h3>Save or share your plan</h3><p class="book-intro"><b>No rush to book everything now: <b>the PDF and Excel files include the ticket links (SeatPlan, Ticketmaster) for your shows, so you can book straight from them later.</b></b></p><div class="actions">',
  'export panel'
);
mustReplace(
  'Done choosing? Review, export or share your plan.',
  'Done choosing? Book your tickets, export or share your plan.',
  'finish bar hint'
);

// 3. Deselect guard also for shows marked as booked.
mustReplace(
  'if(cur.bookingReference){state.pending={deselect:session,name};$(\'deselectText\').innerHTML=`<b>${esc(name)}</b> has a ticket confirmation attached (${esc(cur.bookingReference)}). Deselecting it will remove that confirmation too.`;',
  'if(cur.bookingReference||cur.booked){state.pending={deselect:session,name};$(\'deselectText\').innerHTML=cur.bookingReference?`<b>${esc(name)}</b> has a ticket confirmation attached (${esc(cur.bookingReference)}). Deselecting it will remove that confirmation too.`:`<b>${esc(name)}</b> is marked as booked. Deselecting it removes it from your plan (your tickets are not affected).`;',
  'deselect guard'
);

// 3b. (2026-10-30, Yuval) The chosen card's red button shows only "✕" instead of "Deselect ✕".
//     Cards with several start times keep the time on the chosen button ("19:00 ✕").
mustReplace(
  "\">${o?'Deselect ✕':(multi?esc(t):'Choose')}</button>",
  "\"${o?' aria-label=\"Deselect this performance\"':''}>${o?(multi?esc(t)+' ✕':'✕'):(multi?esc(t):'Choose')}</button>",
  'deselect label'
);

// 4. Styles and script.
const css = fs.readFileSync('booking-checklist.css', 'utf8');
const js = fs.readFileSync('booking-checklist.js', 'utf8');
mustReplace('</head>', `<style id="booking-checklist-css">/* BOOKING_CHECKLIST_PATCH */\n${css}</style>\n</head>`, 'head');
s = s.replace('</body>', `<script id="booking-checklist-script">\n${js}\n</script>\n</body>`);

fs.writeFileSync(file, s);
console.log('patch-booking-checklist: Buy tickets link on cards, Book your tickets checklist, leaving dialog.');
