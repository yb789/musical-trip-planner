import fs from 'node:fs';

// Show kinds in the planner: only shows of the kinds chosen on the opening screen
// (window.mhKindAllowed, from show-helper.js) appear in the sidebar and the day cards.
// Musicals are always allowed, so a visitor who never touches the choice sees what they saw before.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const edits = [
  ["function availableNames(){return new Set((current().schedule[state.active]||[]).map(([n])=>n))}",
   "function kindAllowed(n){return typeof window.mhKindAllowed!=='function'||window.mhKindAllowed(n)}function availableNames(){return new Set((current().schedule[state.active]||[]).map(([n])=>n).filter(kindAllowed))}"],
  ["entries=(current().schedule[state.active]||[]).filter(([n])=>!excluded.has(n))",
   "entries=(current().schedule[state.active]||[]).filter(([n])=>!excluded.has(n)&&kindAllowed(n))"],
  ["function cityShort(){return state.city==='london'?'London musicals':'Broadway musicals'}",
   "function cityShort(){const x=typeof window.mhExtraKinds==='function'&&window.mhExtraKinds();return (state.city==='london'?'London ':'Broadway ')+(x?'shows':'musicals')}"],
  ["setStatus(`Live schedule refreshed: ${data.shows.length} musicals and ${perf} performance slots found.",
   "setStatus(`Live schedule refreshed: ${(()=>{const m=data.shows.filter(s=>!s.kind||s.kind==='musical').length,x=data.shows.length-m;return m+' musicals'+(x?' and '+x+' plays, spectaculars or family shows':'')})()}, ${perf} performance slots found."]
];
let n = 0;
for (const [from, to] of edits) {
  if (s.includes(to)) { n++; continue; }
  if (!s.includes(from)) { console.error('patch-show-kinds: anchor not found: ' + from.slice(0, 70)); process.exit(1); }
  s = s.replace(from, to); n++;
}
fs.writeFileSync(file, s);
console.log(`patch-show-kinds: ${n} edits applied.`);
