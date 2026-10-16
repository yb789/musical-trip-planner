import fs from 'node:fs';

// "from £30" / "from $110.08" under each start time on the day cards, and "Sold out" where
// Broadway.com says so. The schedule APIs attach a third element to a performance tuple:
// [name, time, {from:"£30", url:"<per-performance booking link>", soldOut:true}]; older
// responses and the London calendar fallback have no third element and render as before.
// Runs after patch-show-kinds-2.mjs (anchors on the time cell it produces).
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
function edit(from, to) {
  if (!s.includes(from)) { console.error('patch-ticket-prices: anchor not found: ' + from.slice(0, 80)); process.exit(1); }
  s = s.replace(from, to);
}
edit('function cards(items){',
  "const PRICE_SRC={london:'London Box Office',broadway:'Broadway.com'};" +
  "function perfMetaOf(name,time){const e=(current().schedule[state.active]||[]).find(x=>x[0]===name&&x[1]===time);return (e&&e[2])||null}" +
  "function priceHtml(name,t){const m=perfMetaOf(name,t);if(!m)return '';const src=PRICE_SRC[state.city]||'the seller';" +
  "if(m.soldOut)return `<span class=\"sold-out\" title=\"${src} lists this performance as sold out. Other sellers may still have seats.\">Sold out</span>`;" +
  "return m.from?`<span class=\"from-price\" title=\"Lowest ticket price for this performance on ${src} right now; other sellers may differ\">from ${esc(m.from)}</span>`:''}" +
  'function cards(items){');
edit("(partLabel(name,t,state.active)?`<span class=\"part-label\">${partLabel(name,t,state.active)}</span>`:'')).join('<br>')",
     "(partLabel(name,t,state.active)?`<span class=\"part-label\">${partLabel(name,t,state.active)}</span>`:'')+priceHtml(name,t)).join('<br>')");
// A one-line explanation under the day title, filled in by renderDay when the day has prices.
edit('<h2 id="activeDateTitle"></h2>', '<h2 id="activeDateTitle"></h2><div id="priceNote" class="small price-note"></div>');
edit("function renderDay(){", "function priceNote(){const list=current().schedule[state.active]||[];const any=list.some(x=>x[2]&&(x[2].from||x[2].soldOut));const el=document.getElementById('priceNote');if(!el)return;el.textContent=any?`“from £/$” is the lowest ticket price on ${PRICE_SRC[state.city]||'the seller'} for that performance when we last checked (prices change; other sellers may differ).`:'';el.style.display=any?'':'none'}function renderDay(){priceNote();");
const css = '.price-note{margin:4px 0 0;color:var(--muted)}.from-price,.sold-out{display:block;font:600 11px/1.3 Inter,system-ui,sans-serif;letter-spacing:.01em;cursor:help}.from-price{color:#1f7a4d}.sold-out{color:#b4232c}';
if (!s.includes('.from-price{')) s = s.replace('</style>', css + '</style>');
fs.writeFileSync(file, s);
console.log('patch-ticket-prices: "from £X" and "Sold out" under start times.');
