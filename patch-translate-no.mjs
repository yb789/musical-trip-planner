// Marks proper names in the planner with translate="no", so that browser page translation
// (Chrome, Safari, Edge) leaves show titles, theatre names and addresses, seller names and
// prices as written while it translates the rest of the interface.
// Runs last in build.mjs: it anchors on strings that the earlier patches produce, and stops
// the build if one of them is missing, so a later change cannot silently drop the protection.
// Covered by e2e/tests/translate.spec.js.
import fs from 'node:fs';

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('TRANSLATE_NO_PATCH')) { console.log('patch-translate-no: already applied.'); process.exit(0); }

// n = how many times the text must appear (all of them are replaced).
function rep(label, from, to, n = 1) {
  const found = s.split(from).length - 1;
  if (found !== n) {
    console.error(`patch-translate-no: expected ${n} match${n === 1 ? '' : 'es'} for "${label}", found ${found}`);
    process.exit(1);
  }
  s = s.replaceAll(from, to);
}
const NO = ' translate="no"';
const span = inner => `<span translate="no">${inner}</span>`;

// ---- Day view: the show cards ----
rep('show-card title',
  '<div class="show-title" data-show="${esc(name)}">${esc(cleanShowTitle(name))}',
  '<div class="show-title" data-show="${esc(name)}">' + span('${esc(cleanShowTitle(name))}'));
// Only the theatre name: the "Off-Broadway" / "Off-West End" pills after it stay translatable.
rep('show-card venue',
  '<div class="show-venue">${esc(venue)}',
  '<div class="show-venue">' + span('${esc(venue)}'));
rep('from price',
  'from ${esc(m.from)}</span>',
  'from ' + span('${esc(m.from)}') + '</span>');
rep('one part chosen note',
  'Only one part of ${esc(cleanShowTitle(c.name))} is chosen',
  'Only one part of ' + span('${esc(cleanShowTitle(c.name))}') + ' is chosen');

// ---- Sidebar show filter ----
rep('sidebar title',
  '<b>${esc(cleanShowTitle(s.name))}</b>',
  `<b${NO}>\${esc(cleanShowTitle(s.name))}</b>`);
rep('sidebar venue',
  '<div class="venue-mini">',
  `<div class="venue-mini"${NO}>`);

// ---- Choice summary above the day (matinee / evening) ----
rep('choice summary matinee',
  '<b data-show="${esc(ch.matinee.name)}">',
  `<b data-show="\${esc(ch.matinee.name)}"${NO}>`);
rep('choice summary evening',
  '<b data-show="${esc(ch.evening.name)}">',
  `<b data-show="\${esc(ch.evening.name)}"${NO}>`);

// ---- My calendar, the extra Morning / Late choices, and the "leaving the site" box ----
rep('chosen show titles',
  '<b data-show="${esc(c.name)}">',
  `<b data-show="\${esc(c.name)}"${NO}>`, 3);
rep('calendar venue',
  "🎭 ${esc(loc.venue||'Theater / Venue')}</div>",
  "🎭 ${loc.venue?`" + span('${esc(loc.venue)}') + "`:'Theater / Venue'}</div>");
rep('calendar address',
  '<div class="calendar-address">',
  `<div class="calendar-address"${NO}>`);

// ---- Dialogs: remove a booked show, same show chosen twice ----
rep('dialog show name',
  '<b>${esc(name)}</b>',
  `<b${NO}>\${esc(name)}</b>`, 3);

// ---- Hover box with the show description ----
rep('tooltip title', `<div class="tip-title">'+esc(title)`, `<div class="tip-title"${NO}>'+esc(title)`);
rep('tooltip venue', `'<div class="tip-venue">🎭 '+esc(venue)+'</div>'`, `'<div class="tip-venue">🎭 <span${NO}>'+esc(venue)+'</span></div>'`);

// ---- Seller buttons: the label translates, the seller's name does not ----
rep('SeatPlan button', '>Tickets on SeatPlan ↗<', '>Tickets on ' + span('SeatPlan') + ' ↗<');
rep('Ticketmaster button', '>Tickets on Ticketmaster ↗<', '>Tickets on ' + span('Ticketmaster') + ' ↗<', 2);

// ---- "Also on today" list (concerts) ----
rep('also-today title', `<span class="also-main"><b>'+esc(c.name)+'</b>'`, `<span class="also-main"><b${NO}>'+esc(c.name)+'</b>'`);
rep('also-today venue', `'<span class="also-venue">'`, `'<span class="also-venue"${NO}>'`);
rep('also-today price', `'<span class="also-price">from '+esc(c.from)+'</span>'`, `'<span class="also-price">from <span${NO}>'+esc(c.from)+'</span></span>'`);

// ---- Ticket confirmation dialog ----
rep('ticket dialog show',
  "<b>${esc(typeof cleanShowTitle==='function'?cleanShowTitle(choice.name):choice.name)}</b> · ${esc(choice.time)}<br>${esc(fmt(date))}${venue?`<br>${esc(venue)}`:''}",
  `<b${NO}>\${esc(typeof cleanShowTitle==='function'?cleanShowTitle(choice.name):choice.name)}</b> · \${esc(choice.time)}<br>\${esc(fmt(date))}\${venue?\`<br>${span('${esc(venue)}')}\`:''}`);

// ---- Calendar-first planner: the slot boxes and the timing warnings ----
rep('calendar slot show',
  '<b class="pc-slot-show">',
  `<b class="pc-slot-show"${NO}>`);
rep('timing warning show',
  'const b=v=>html?`<b>${esc(cleanShowTitle(v))}</b>`',
  `const b=v=>html?\`<b${NO}>\${esc(cleanShowTitle(v))}</b>\``);
rep('hidden choice show',
  'Your choice <b>${esc(cleanShowTitle(ch[slot].name))}</b>',
  `Your choice <b${NO}>\${esc(cleanShowTitle(ch[slot].name))}</b>`);

// ---- Booking checklist ("Finish planning") and the "Did you book…?" reminder ----
rep('checklist show',
  '<div class="book-show" data-show="${esc(c.name)}">${esc(title(c))}',
  '<div class="book-show" data-show="${esc(c.name)}">' + span('${esc(title(c))}'));
rep('checklist venue',
  '<div class="book-venue">',
  `<div class="book-venue"${NO}>`);
rep('leaving-box venue',
  '${venueOf(c)?`<br>${esc(venueOf(c))}`:\'\'}`;',
  '${venueOf(c)?`<br>' + span('${esc(venueOf(c))}') + '`:\'\'}`;');
rep('booked reminder show',
  '<b>${esc(title(c))}</b>',
  `<b${NO}>\${esc(title(c))}</b>`);
// "Theatre website" is a label and translates; SeatPlan / Ticketmaster are names and do not.
rep('checklist seller names',
  '${esc(sellerLabel(s))}',
  '${s.label?esc(s.label):`' + span('${esc(s.name)}') + '`}', 2);

// ---- "Help me choose" ----
rep('helper title', '<div class="mh-show-title">', `<div class="mh-show-title"${NO}>`);
rep('helper venue', '<div class="mh-show-venue">', `<div class="mh-show-venue"${NO}>`);
rep('helper shortlist chips',
  `<span class="mh-chip\${live && !live.has(g.id) ? ' off' : ''}">`,
  `<span class="mh-chip\${live && !live.has(g.id) ? ' off' : ''}"${NO}>`);
rep('helper not-playing list',
  "${missing.map(g => h(g.title)).join(', ')}",
  span("${missing.map(g => h(g.title)).join(', ')}"));

s = s.replace('</head>', '<!-- TRANSLATE_NO_PATCH --></head>');
fs.writeFileSync(file, s);
console.log('patch-translate-no: show titles, theatres, seller names and prices marked translate="no".');
