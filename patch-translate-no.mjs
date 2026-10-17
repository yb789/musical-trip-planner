// Marks proper names in the planner with translate="no" so that browser page
// translation (Chrome, Safari, Edge) leaves show titles, theatre names, seller
// names and prices as written while translating the rest of the interface.
// Runs last in build.mjs: it anchors on strings that earlier patches produce.
import fs from 'node:fs';

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('TRANSLATE_NO_PATCH')) { console.log('patch-translate-no: already applied.'); process.exit(0); }

function rep(label, from, to, { all = false } = {}) {
  const n = s.split(from).length - 1;
  if (n === 0 || (!all && n !== 1)) {
    console.error(`patch-translate-no: expected ${all ? 'at least one' : 'exactly one'} match for "${label}", found ${n}`);
    process.exit(1);
  }
  s = all ? s.replaceAll(from, to) : s.replace(from, to);
}

// Day cards: title and venue (the second .show-venue, "N start times…", stays translatable).
rep('show-card title',
  '<div class="show-title" data-show="${esc(name)}">',
  '<div class="show-title" data-show="${esc(name)}" translate="no">');
rep('show-card venue',
  '<div class="show-venue">${esc(venue)}',
  '<div class="show-venue" translate="no">${esc(venue)}');

// Sidebar list.
rep('sidebar title',
  '<b>${esc(cleanShowTitle(s.name))}</b>',
  '<b translate="no">${esc(cleanShowTitle(s.name))}</b>');
rep('sidebar venue',
  '<div class="venue-mini">',
  '<div class="venue-mini" translate="no">');

// Choice summary above the day (matinee / evening).
rep('choice summary matinee',
  '<b data-show="${esc(ch.matinee.name)}">',
  '<b data-show="${esc(ch.matinee.name)}" translate="no">');
rep('choice summary evening',
  '<b data-show="${esc(ch.evening.name)}">',
  '<b data-show="${esc(ch.evening.name)}" translate="no">');

// My calendar.
rep('calendar title',
  '<b data-show="${esc(c.name)}">',
  '<b data-show="${esc(c.name)}" translate="no">', { all: true });
rep('calendar venue',
  '<div class="calendar-venue">',
  '<div class="calendar-venue" translate="no">', { all: true });

// Hover tooltip (inlined by patch-show-tooltip).
rep('tooltip title', `'<div class="tip-body"><div class="tip-title">'`, `'<div class="tip-body"><div class="tip-title" translate="no">'`);
rep('tooltip venue', `'<div class="tip-venue">🎭 '`, `'<div class="tip-venue" translate="no">🎭 '`);

// Seller buttons: the label translates, the seller name does not.
rep('SeatPlan button', '>Tickets on SeatPlan ↗<', '>Tickets on <span translate="no">SeatPlan</span> ↗<', { all: true });
rep('Ticketmaster button', '>Tickets on Ticketmaster ↗<', '>Tickets on <span translate="no">Ticketmaster</span> ↗<', { all: true });

// "from £30" price: the amount stays as written.
rep('from price',
  'from ${esc(m.from)}</span>',
  'from <span translate="no">${esc(m.from)}</span></span>');

s = s.replace('</head>', '<!-- TRANSLATE_NO_PATCH --></head>');
fs.writeFileSync(file, s);
console.log('patch-translate-no: translate="no" added to show titles, venues, seller names and prices.');
