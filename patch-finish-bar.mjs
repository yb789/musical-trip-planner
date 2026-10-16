import fs from 'node:fs';

// "Finish planning" next to the planning pane (2026-10-16, requested by Yuval).
// Before: the button sat in the trip bar at the top of the page, out of sight once you scroll
//         down a long list of performances.
// After:  it lives at the bottom of the planner panel in a bar that sticks to the bottom of
//         the viewport while the panel is on screen, so it is reachable from anywhere in the list.
// Runs last in build.mjs (after patch-share-plan.mjs, which rewrites the trip-bar buttons).
// The click handler is bound by id, so moving the element changes nothing in the JS.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('FINISH_BAR_PATCH')) { console.log('patch-finish-bar: already applied.'); process.exit(0); }

function mustReplace(search, replacement, label) {
  const n = s.split(search).length - 1;
  if (n !== 1) { console.error(`patch-finish-bar: expected one match for "${label}", found ${n}`); process.exit(1); }
  s = s.replace(search, () => replacement);
}

const btn = '<button id="finishBtn" class="primary">Finish planning</button>';

// 1. Out of the trip bar.
mustReplace(btn, '', 'finish button in trip bar');

// 2. Into the planner panel, under the Choose shows / My calendar views.
mustReplace(
  '<div id="calendar"></div></div></section>',
  `<div id="calendar"></div></div><div class="finish-bar"><div class="small">Done choosing? Review, export or share your plan.</div>${btn}</div></section>`,
  'planner section end'
);

// 3. Sticky bar: stays at the bottom of the window while the planner panel is in view.
mustReplace(
  '.planner{padding:18px}',
  '.planner{padding:18px 18px 0}/* FINISH_BAR_PATCH */.finish-bar{position:sticky;bottom:0;z-index:5;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin:16px -18px 0;padding:12px 18px;background:var(--paper);border-top:1px solid var(--line);border-radius:0 0 18px 18px;box-shadow:0 -8px 24px rgba(30,25,20,.08)}.finish-bar .small{flex:1 1 200px}.finish-bar #finishBtn{padding:12px 22px;font-size:15px;font-weight:800;min-height:46px}',
  'planner css'
);

fs.writeFileSync(file, s);
console.log('patch-finish-bar: Finish planning moved into a sticky bar at the bottom of the planner.');
