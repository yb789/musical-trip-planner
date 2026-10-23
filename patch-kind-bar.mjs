import fs from 'node:fs';

// Category bar at the top of each day (Yuval, 23 Oct 2026): one toggle per show kind
// (Musicals, Big plays, Spectaculars, Concerts, Family shows) with the number of shows of that kind
// playing on the day. It starts from the opening-screen choice and changes it for the whole trip
// (window.mhSetKind, show-helper.js). Musicals can be switched off here (not on the opening screen);
// at least one category always stays on. Shows already chosen are never removed: only the cards to
// choose from are filtered. Runs after patch-concerts.mjs (wraps the same renderDay).
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

const anchor = '<div class="sessions">';
if (!s.includes('id="kindBar"')) {
  if (s.split(anchor).length !== 2) { console.error('patch-kind-bar: anchor not found once: ' + anchor); process.exit(1); }
  s = s.replace(anchor, '<div id="kindBar" class="kind-bar" role="group" aria-label="Categories shown for your trip"></div>' + anchor);
}

const js = `<script>/* KIND_BAR */
(function(){
  function kindOf(n){try{return typeof window.mhKindOf==='function'?(window.mhKindOf(n)||'musical'):'musical'}catch(e){return 'musical'}}
  function counts(){
    const c={},seen=new Set();
    let entries=[];try{entries=current().schedule[state.active]||[]}catch(e){}
    for(const [n] of entries){if(seen.has(n))continue;seen.add(n);const k=kindOf(n);c[k]=(c[k]||0)+1}
    try{const one=((state.data[state.city]||{}).oneOffs||{})[state.active]||[];const names=new Set(one.map(x=>x.name));c.concert=(c.concert||0)+names.size}catch(e){}
    return c;
  }
  function renderKindBar(){
    const bar=document.getElementById('kindBar');if(!bar)return;
    if(typeof window.mhKindList!=='function'||!state.active){bar.hidden=true;return}
    const list=window.mhKindList(),c=counts(),onCount=list.filter(k=>k.on).length;
    bar.hidden=false;
    bar.innerHTML='<span class="kind-bar-label">Show:</span>'+list.map(k=>{
      const n=c[k.id]||0,empty=!n&&!k.on,last=k.on&&onCount===1;
      return '<button type="button" class="kind-chip'+(k.on?' on':'')+(empty?' empty':'')+'" data-kind="'+k.id+'" aria-pressed="'+k.on+'"'+(empty?' disabled':'')
        +(last?' title="At least one category stays on"':'')+'>'+(k.on?'✓ ':'')+esc(k.label)+' <span class="kind-n">'+n+'</span></button>';
    }).join('')+'<span class="kind-bar-msg" role="status" aria-live="polite"></span>';
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('#kindBar .kind-chip');if(!b||b.disabled)return;
    const on=b.getAttribute('aria-pressed')!=='true';
    const ok=typeof window.mhSetKind==='function'&&window.mhSetKind(b.dataset.kind,on);
    if(!ok){const m=document.querySelector('#kindBar .kind-bar-msg');if(m)m.textContent='Keep at least one category on.';return}
    try{if(typeof window.mtpTrack==='function')window.mtpTrack('kind_toggle',{show:b.dataset.kind+(on?':on':':off')})}catch(err){}
    document.querySelector('#kindBar [data-kind="'+b.dataset.kind+'"]')?.focus();
  });
  window.renderKindBar=renderKindBar;
  const prev=renderDay;
  renderDay=function(){const r=prev.apply(this,arguments);try{renderKindBar()}catch(e){console.error(e)}return r};
})();
</script>`;

const css = `.kind-bar{display:flex;align-items:center;gap:8px;margin:12px 0 14px;overflow-x:auto;padding-bottom:4px;scrollbar-width:thin}
.kind-bar-label{font-weight:700;font-size:14px;flex:none}
.kind-chip{--c:var(--accent);flex:none;display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;border-radius:999px;border:1.5px solid var(--c);background:#fff;color:var(--c);font:600 14px/1 Inter,system-ui,sans-serif;cursor:pointer;white-space:nowrap}
.kind-chip.on{background:var(--c);color:#fff}
.kind-chip.empty{opacity:.45;cursor:default}
.kind-chip .kind-n{font-size:12px;font-weight:700;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--c) 14%,#fff);color:var(--c)}
.kind-chip.on .kind-n{background:rgba(255,255,255,.25);color:#fff}
.kind-chip[data-kind=play]{--c:var(--kind-play,#4f46a0)}.kind-chip[data-kind=spectacular]{--c:var(--kind-spectacular,#b4560d)}
.kind-chip[data-kind=concert]{--c:var(--kind-concert,#0f6e78)}.kind-chip[data-kind=family]{--c:var(--kind-family,#1f7a4d)}
.kind-bar-msg{font-size:12px;color:#8a2515;flex:none}
`;

if (!s.includes('/* KIND_BAR */')) {
  const at = s.lastIndexOf('</body>');
  if (at < 0) { console.error('patch-kind-bar: </body> not found'); process.exit(1); }
  s = s.slice(0, at) + js + '\n' + s.slice(at);
}
if (!s.includes('.kind-bar{')) s = s.replace('</style>', css + '</style>');
fs.writeFileSync(file, s);
console.log('patch-kind-bar: applied.');
