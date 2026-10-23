import fs from 'node:fs';

// Concerts, part 2 (Yuval, 23 Oct 2026): one-night concerts are listed under the day's shows as
// "Also on this day", for information only — no Choose button, not in the sidebar, the plan, the
// calendar or the exports. Running concerts are ordinary planner cards (kind "concert", teal), handled
// by date-calendar.js and patch-show-kinds-2.mjs. Both appear only when the visitor ticked
// "Spectaculars & concerts" on the opening screen (window.mhConcertsAllowed, show-helper.js).
// Data: state.data[city].oneOffs[date] = [{name, time, venue, from, url}] (filled by date-calendar.js).
// Runs last in build.mjs.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

const js = `<script>/* CONCERTS_ONE_OFF */
(function(){
  function oneOffsFor(d){try{const x=(state.data[state.city]||{}).oneOffs||{};return Array.isArray(x[d])?x[d]:[]}catch(e){return []}}
  function allowed(){return typeof window.mhConcertsAllowed!=='function'||window.mhConcertsAllowed()}
  function renderAlsoToday(){
    const anchor=document.getElementById('eveningList');if(!anchor)return;
    let box=document.getElementById('alsoToday');
    if(!box){box=document.createElement('section');box.id='alsoToday';box.className='also-today';box.setAttribute('aria-label','Also on this day');const host=anchor.closest('.session')||anchor.parentElement;host.after(box)}
    const list=allowed()?oneOffsFor(state.active).slice().sort((a,b)=>String(a.time).localeCompare(String(b.time))||String(a.name).localeCompare(String(b.name))):[];
    if(!list.length){box.hidden=true;box.innerHTML='';return}
    box.hidden=false;
    box.innerHTML='<h3>Also on this day <span class="also-sub">one-night concerts</span></h3>'
      +'<p class="also-note">Single performances in central London, listed for information. They are not added to your plan, calendar or exports.</p>'
      +'<ul>'+list.map(c=>'<li><span class="also-time">'+esc(c.time)+'</span><span class="also-main"><b>'+esc(c.name)+'</b>'
        +(c.venue?'<span class="also-venue">'+esc(c.venue)+'</span>':'')+'</span>'
        +(c.from?'<span class="also-price">from '+esc(c.from)+'</span>':'')
        +(c.url?'<a class="also-link" target="_blank" rel="noopener sponsored" href="'+esc(c.url)+'">Tickets on Ticketmaster ↗</a>':'')
        +'</li>').join('')+'</ul>';
  }
  window.renderAlsoToday=renderAlsoToday;
  const prev=renderDay;
  renderDay=function(){const r=prev.apply(this,arguments);try{renderAlsoToday()}catch(e){console.error(e)}return r};
})();
</script>`;

const css = `.also-today{grid-column:1/-1;margin:14px 0 4px;padding:12px 14px;border:1px dashed var(--kind-concert,#0f6e78);border-radius:14px;background:color-mix(in srgb,var(--kind-concert,#0f6e78) 5%,#fff)}
.also-today h3{margin:0 0 2px;font:700 16px/1.3 Georgia,serif;color:var(--kind-concert,#0f6e78)}
.also-today .also-sub{font:600 12px/1 Inter,system-ui,sans-serif;color:var(--muted);margin-left:6px}
.also-today .also-note{margin:0 0 8px;font-size:12px;color:var(--muted)}
.also-today ul{list-style:none;margin:0;padding:0}
.also-today li{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;padding:8px 0;border-top:1px solid var(--line)}
.also-today li:first-child{border-top:0}
.also-today .also-time{font-weight:700;min-width:44px}
.also-today .also-main{flex:1 1 180px;min-width:0}
.also-today .also-main b{display:block}
.also-today .also-venue{display:block;font-size:12px;color:var(--muted)}
.also-today .also-price{font-size:12px;color:var(--muted)}
.also-today .also-link{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;background:#024ddf;color:#fff;font-size:13px;font-weight:600;text-decoration:none}
`;

if (!s.includes('/* CONCERTS_ONE_OFF */')) {
  const at = s.lastIndexOf('</body>');
  if (at < 0) { console.error('patch-concerts: </body> not found'); process.exit(1); }
  s = s.slice(0, at) + js + '\n' + s.slice(at);
}
if (!s.includes('.also-today{')) {
  if (!s.includes('</style>')) { console.error('patch-concerts: </style> not found'); process.exit(1); }
  s = s.replace('</style>', css + '</style>');
}
fs.writeFileSync(file, s);
console.log('patch-concerts: applied.');
