import fs from 'node:fs';

// Ticket buttons next to the chosen performance (2026-09-19, requested by Yuval).
// Before: "Tickets on SeatPlan" / "Theater / venue tickets" sat in the day summary at the top of the day panel.
// After:  they sit inside the selected show card (under the title, beside "Selected ✓"); the summary keeps name + time.
// Runs right after patch-index.mjs; the `<div class="show-title">…</div>` anchor used by patch-show-tooltip is untouched.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('TICKET_LINKS_PLACEMENT_PATCH')) { console.log('patch-ticket-links-placement: already applied.'); process.exit(0); }

function mustReplace(search, replacement, label) {
  const n = s.split(search).length - 1;
  if (n !== 1) { console.error(`patch-ticket-links-placement: expected one match for "${label}", found ${n}`); process.exit(1); }
  s = s.replace(search, () => replacement);
}

// 1. Summary at the top of the day: drop the link buttons (keep show name + time).
mustReplace('<br>${linkHtml(ch.matinee)}', '', 'summary matinee links');
mustReplace('<br>${linkHtml(ch.evening)}', '', 'summary evening links');

// 2. Selected card: add the buttons under the title / venue.
mustReplace(
  `<div class="show-venue">\${esc(m.venue||'')}</div></div><button class="pick`,
  `<div class="show-venue">\${esc(m.venue||'')}</div>\${on?\`<div class="card-links">\${linkHtml(ch[session])}</div>\`:''}</div><button class="pick`,
  'card links'
);

// 3. CSS: highlight the chosen card and lay out the button row. /* TICKET_LINKS_PLACEMENT_PATCH */
mustReplace(
  '.pick.selected{background:var(--green);border-color:var(--green);color:white}',
  '.pick.selected{background:var(--green);border-color:var(--green);color:white}/* TICKET_LINKS_PLACEMENT_PATCH */.show-card:has(.pick.selected){background:#f3f8f5;border-radius:12px;padding-left:8px;padding-right:8px;margin:0 -8px}.card-links{margin-top:2px}.card-links .ticket-link,.card-links .venue-link{margin:4px 6px 0 0}',
  'card css'
);

fs.writeFileSync(file, s);
console.log('patch-ticket-links-placement: ticket buttons moved into the selected card.');
