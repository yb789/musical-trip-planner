import fs from 'node:fs';

// Show kinds, part 2 (Yuval, 16 Oct 2026): a play, spectacular or family show is visibly different
// in the planner — coloured left edge + a kind pill on the day cards, the sidebar, the choice
// summary and My calendar — and two-part plays (Harry Potter and the Cursed Child: guide fields
// parts:2 / partsNote) get "Part One" / "Part Two" labels, a note on the card and a warning when a
// day has only one part. Exports carry a Kind column and the part label.
// Runs last in build.mjs (after patch-group-times.mjs, whose cards() it edits).
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

const helpers = `/* SHOW_KINDS_2 */
const KIND_LABEL={play:'Play',spectacular:'Spectacular',concert:'Concert',family:'Family show'};
function kindOfShow(n){try{return typeof window.mhKindOf==='function'?(window.mhKindOf(n)||'musical'):'musical'}catch(e){return 'musical'}}
function kindPill(n){const k=kindOfShow(n);return KIND_LABEL[k]?\` <span class="kind-pill" data-kind="\${k}">\${KIND_LABEL[k]}</span>\`:''}
function guideFor(n){try{return typeof window.mhGuideEntry==='function'?window.mhGuideEntry(n):null}catch(e){return null}}
function partsOf(n){const g=guideFor(n);return g&&g.parts===2?g:null}
// Afternoon = Part One. Evening = Part Two, except Thursday (Part One; Friday evening is Part Two).
function partLabel(n,time,date){if(!partsOf(n))return '';if(mins(time)<1020)return 'Part One';return parseISO(date).getDay()===4?'Part One':'Part Two'}
const PARTS_SHORT='Two-part play: Part One and Part Two are separate tickets; you need both to see the whole story.';
function partsWarning(ch,date){const m=ch.matinee&&partsOf(ch.matinee.name)?ch.matinee:null,e=ch.evening&&partsOf(ch.evening.name)?ch.evening:null;if(!m&&!e)return '';if(m&&e&&m.name===e.name)return '';const wd=parseISO(date).getDay();if(wd===4||wd===5)return '';const c=m||e;return \`<div class="parts-note">Only one part of \${esc(cleanShowTitle(c.name))} is chosen for this day — \${m?'Part Two plays in the evening':'Part One plays in the afternoon'}. You need both parts to see the whole story.</div>\`}
`;
const edits = [
  // helpers before cards()
  ['function cards(items){', helpers + 'function cards(items){'],
  // day cards: kind on the article, pill after the title, part labels in the time cell, note on two-part shows
  ['<article class="show-card${multi?\' multi\':\'\'}">', '<article class="show-card${multi?\' multi\':\'\'}" data-kind="${kindOfShow(name)}">'],
  ['<div class="time${multi?\' multi\':\'\'}">${multi?times.map(esc).join(\'<br>\'):esc(times[0])}</div>',
   '<div class="time${multi?\' multi\':\'\'}">${(multi?times:[times[0]]).map(t=>esc(t)+(partLabel(name,t,state.active)?`<span class="part-label">${partLabel(name,t,state.active)}</span>`:\'\')).join(\'<br>\')}</div>'],
  ['<div class="show-title" data-show="${esc(name)}">${esc(cleanShowTitle(name))}</div>',
   '<div class="show-title" data-show="${esc(name)}">${esc(cleanShowTitle(name))}${kindPill(name)}</div>${partsOf(name)?`<div class="parts-note">${PARTS_SHORT}</div>`:\'\'}'],
  // sidebar rows
  ["row.className='musical-row';", "row.className='musical-row';row.dataset.kind=kindOfShow(s.name);"],
  ['<b>${esc(cleanShowTitle(s.name))}</b><div class="venue-mini">', '<b>${esc(cleanShowTitle(s.name))}</b>${kindPill(s.name)}<div class="venue-mini">'],
  // choice summary + one-part warning
  ['Matinee: <b data-show="${esc(ch.matinee.name)}">${esc(cleanShowTitle(ch.matinee.name))}</b>', 'Matinee: <b data-show="${esc(ch.matinee.name)}">${esc(cleanShowTitle(ch.matinee.name))}</b>${kindPill(ch.matinee.name)}'],
  ['Evening: <b data-show="${esc(ch.evening.name)}">${esc(cleanShowTitle(ch.evening.name))}</b>', 'Evening: <b data-show="${esc(ch.evening.name)}">${esc(cleanShowTitle(ch.evening.name))}</b>${kindPill(ch.evening.name)}'],
  [":'Evening: none';", ":'Evening: none';$('eveningChoice').innerHTML+=partsWarning(ch,state.active);"],
  // My calendar
  ['calendar-choice"><b data-show="${esc(c.name)}">${icon} ${esc(cleanShowTitle(c.name))}</b>', 'calendar-choice" data-kind="${kindOfShow(c.name)}"><b data-show="${esc(c.name)}">${icon} ${esc(cleanShowTitle(c.name))}</b>${kindPill(c.name)}'],
  // saved choices carry the kind (shared plans, older-version imports)
  ["venueUrl:m.venueUrl||''};save();", "venueUrl:m.venueUrl||'',kind:kindOfShow(name)};save();"],
  // exports
  ['musical:cleanShowTitle(c.name),', "musical:cleanShowTitle(c.name)+(partLabel(c.name,c.time,d)?' — '+partLabel(c.name,c.time,d):''),kind:KIND_LABEL[kindOfShow(c.name)]||'Musical',"],
  ["'Musical','Theater / Venue'", "'Musical','Kind','Theater / Venue'"],
  ["'musical','venue'", "'musical','kind','venue'"],
  ['${kept} of ${available.length} musicals available on this date kept', "${kept} of ${available.length} ${typeof window.mhExtraKinds==='function'&&window.mhExtraKinds()?'shows':'musicals'} available on this date kept"]
];
let n = 0;
for (const [from, to] of edits) {
  if (s.includes(to)) { n++; continue; }
  const count = s.split(from).length - 1;
  if (!count) { console.error('patch-show-kinds-2: anchor not found: ' + from.slice(0, 80)); process.exit(1); }
  s = s.split(from).join(to); n++;
}
const css = `:root{--kind-play:#4f46a0;--kind-spectacular:#b4560d;--kind-concert:#0f6e78;--kind-family:#1f7a4d}
.kind-pill{display:inline-block;margin-left:2px;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.5;vertical-align:middle;color:#fff;white-space:nowrap}
.kind-pill[data-kind=play]{background:var(--kind-play)}.kind-pill[data-kind=spectacular]{background:var(--kind-spectacular)}.kind-pill[data-kind=family]{background:var(--kind-family)}.kind-pill[data-kind=concert]{background:var(--kind-concert)}
.show-card[data-kind=concert],.musical-row[data-kind=concert],.calendar-choice[data-kind=concert]{box-shadow:inset 4px 0 0 var(--kind-concert)}
.show-card[data-kind=play],.musical-row[data-kind=play],.calendar-choice[data-kind=play]{box-shadow:inset 4px 0 0 var(--kind-play)}
.show-card[data-kind=spectacular],.musical-row[data-kind=spectacular],.calendar-choice[data-kind=spectacular]{box-shadow:inset 4px 0 0 var(--kind-spectacular)}
.show-card[data-kind=family],.musical-row[data-kind=family],.calendar-choice[data-kind=family]{box-shadow:inset 4px 0 0 var(--kind-family)}
.show-card[data-kind]:not([data-kind=musical]){padding-left:10px}.musical-row[data-kind]:not([data-kind=musical]){padding-left:8px}
.part-label{display:block;font:600 11px/1.3 Inter,system-ui,sans-serif;color:var(--muted);letter-spacing:.02em}
.parts-note{font-size:12px;line-height:1.4;color:#73520b;background:#fff2d9;border:1px solid #e5c681;border-radius:8px;padding:5px 8px;margin-top:5px}
`;
if (!s.includes('.kind-pill{')) s = s.replace('</style>', css + '</style>');
fs.writeFileSync(file, s);
console.log(`patch-show-kinds-2: ${n} edits applied.`);
