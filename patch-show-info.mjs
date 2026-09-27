import fs from 'node:fs';

// Show info panel: an (i) button next to each musical's name (sidebar list and performance
// cards) opens a panel with our own catalogue entry from /api/shows: description, style tags,
// running time, age guidance, content notes and, for limited runs, the final performance.
// Works on touch screens (the hover tooltip does not). Also exposes window.showInfoLookup(name),
// which the hover tooltip uses. Must run after patch-show-tooltip.mjs.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

function mustReplace(search, replacement, label) {
  if (!s.includes(search)) {
    console.error(`Patch target not found: ${label}`);
    process.exit(1);
  }
  s = s.replaceAll(search, replacement);
}

if (!s.includes('class="info-btn"')) {
  mustReplace(
    '<b>${esc(cleanShowTitle(s.name))}</b><div class="venue-mini">',
    '<b>${esc(cleanShowTitle(s.name))}</b><button type="button" class="info-btn" data-info="${esc(s.name)}" aria-label="About ${esc(cleanShowTitle(s.name))}" title="About this show">i</button><div class="venue-mini">',
    'sidebar musical name'
  );
  mustReplace(
    '<div class="show-title" data-show="${esc(name)}">${esc(cleanShowTitle(name))}</div>',
    '<div class="show-title" data-show="${esc(name)}">${esc(cleanShowTitle(name))}<button type="button" class="info-btn" data-info="${esc(name)}" aria-label="About ${esc(cleanShowTitle(name))}" title="About this show">i</button></div>',
    'performance card title'
  );
}

const css = `
.info-btn{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-left:7px;padding:0;border-radius:50%;border:1px solid var(--line);background:var(--paper);color:var(--accent);font:italic 700 13px Georgia,serif;cursor:pointer;vertical-align:2px;line-height:1;flex:none}
.info-btn:hover,.info-btn:focus-visible{background:var(--accent);color:#fff;border-color:var(--accent);outline:none}
@media(max-width:900px){.info-btn{width:28px;height:28px;font-size:15px}}
#showInfo{border:0;padding:0;border-radius:18px;width:min(560px,calc(100vw - 24px));max-height:calc(100vh - 32px);background:var(--paper);color:var(--ink);box-shadow:0 30px 80px rgba(30,25,20,.35)}
#showInfo::backdrop{background:rgba(25,20,15,.55)}
#showInfo .si-wrap{padding:22px 22px 18px;overflow:auto;max-height:calc(100vh - 32px);box-sizing:border-box}
#showInfo .si-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}
#showInfo h2{font:700 24px Georgia,serif;margin:0 0 3px}
#showInfo .si-venue{color:var(--muted);font-size:14px}
#showInfo .si-close{padding:0;border:1px solid var(--line);background:transparent;border-radius:50%;width:36px;height:36px;font-size:20px;line-height:1;cursor:pointer;color:var(--ink);flex:none}
#showInfo .si-desc{font-size:15px;line-height:1.55;margin:14px 0 12px}
#showInfo .si-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
#showInfo .si-chip{font-size:12px;padding:4px 9px;border-radius:999px;background:var(--bg);border:1px solid var(--line)}
#showInfo dl{display:grid;grid-template-columns:max-content 1fr;gap:7px 14px;margin:0 0 12px;font-size:14px}
#showInfo dt{font-weight:700}
#showInfo dd{margin:0}
#showInfo .si-note{font-size:12px;color:var(--muted);margin:10px 0 14px}
#showInfo .si-actions{display:flex;gap:8px;flex-wrap:wrap}
#showInfo .si-actions a,#showInfo .si-actions button{font:600 14px system-ui,sans-serif;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--ink);text-decoration:none;cursor:pointer}
#showInfo .si-actions a.primary{background:var(--accent);border-color:var(--accent);color:#fff}
#showInfo .si-play{display:inline-block;font-size:12px;font-weight:700;color:var(--accent);margin-top:4px}
`;
if (!s.includes('#showInfo{')) s = s.replace('</style>', css + '</style>');

const js = `
<script>
(()=>{
  const cache={};
  function key(v){
    let k=String(v||'').toLowerCase().normalize('NFKD').replace(/\\p{M}/gu,'');
    k=k.replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');
    k=k.replace(/^disneys/,'').replace(/^the/,'').replace(/themusical$/,'').replace(/musical$/,'');
    return k;
  }
  async function catalogue(city){
    if(!cache[city])cache[city]=fetch('/api/shows?city='+encodeURIComponent(city)).then(r=>r.ok?r.json():{shows:[]}).then(d=>d.shows||[]).catch(()=>{delete cache[city];return []});
    return cache[city];
  }
  const loaded={};
  function currentCity(){return (typeof state!=='undefined'&&state&&state.city)||'london'}
  function lookup(name){
    const city=currentCity();
    if(!loaded[city]){catalogue(city).then(list=>{if(list.length)loaded[city]=list});return null}
    return find(loaded[city],name);
  }
  function find(shows,name){
    const k=key(name);
    let hit=shows.find(x=>[x.name].concat(x.aliases||[]).some(a=>key(a)===k));
    if(!hit&&k.length>5)hit=shows.find(x=>{const kk=key(x.name);return kk.length>5&&(kk.includes(k)||k.includes(kk))});
    return hit||null;
  }
  const dlg=document.createElement('dialog');
  dlg.id='showInfo';
  dlg.setAttribute('aria-labelledby','siTitle');
  document.body.appendChild(dlg);
  dlg.addEventListener('click',e=>{if(e.target===dlg)dlg.close()});
  function fmtDate(iso){try{return new Date(iso+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'})}catch{return iso}}
  function render(name,entry){
    const meta=(typeof showMeta==='function'&&showMeta(name))||{};
    const title=typeof cleanShowTitle==='function'?cleanShowTitle(name):name;
    const venue=(entry&&entry.venue)||meta.venue||'';
    let h='<div class="si-wrap"><div class="si-head"><div><h2 id="siTitle">'+esc(title)+'</h2>'
      +(venue?'<div class="si-venue">🎭 '+esc(venue)+'</div>':'')
      +(entry&&entry.isMusical===false?'<span class="si-play">A play, not a musical</span>':'')
      +'</div><button type="button" class="si-close" aria-label="Close">×</button></div>';
    if(entry){
      h+='<p class="si-desc">'+esc(entry.description)+'</p>';
      const chips=[].concat(entry.tone||[],entry.music||[],entry.scale?[entry.scale]:[],entry.familiarity?[entry.familiarity]:[]);
      if(chips.length)h+='<div class="si-chips">'+chips.map(c=>'<span class="si-chip">'+esc(c)+'</span>').join('')+'</div>';
      h+='<dl>'
        +'<dt>Running time</dt><dd>'+esc(entry.runningTime)+'</dd>'
        +'<dt>Age guidance</dt><dd>'+esc(entry.age)+'</dd>'
        +'<dt>Content notes</dt><dd>'+esc(entry.content)+'</dd>'
        +(entry.goodFor?'<dt>Good for</dt><dd>'+esc(entry.goodFor)+'</dd>':'')
        +(entry.finalPerformance?'<dt>Final performance</dt><dd>'+esc(fmtDate(entry.finalPerformance))+'</dd>':'')
        +'</dl><p class="si-note">Running time and age guidance come from the official production or its ticket sellers and can change. Please check with the theatre before booking.</p>';
    }else{
      h+='<p class="si-desc">A description of this show is coming soon.</p>';
    }
    h+='<div class="si-actions">';
    if(/^https:\\/\\//.test(meta.ticketUrl||''))h+='<a class="primary" href="'+esc(meta.ticketUrl)+'" target="_blank" rel="noopener sponsored">Tickets ↗</a>';
    h+='<button type="button" class="si-close-2">Close</button></div></div>';
    dlg.innerHTML=h;
    dlg.querySelectorAll('.si-close,.si-close-2').forEach(b=>b.addEventListener('click',()=>dlg.close()));
  }
  async function open(name){
    const city=currentCity();
    render(name,null);
    dlg.querySelector('.si-desc').textContent='Loading…';
    if(!dlg.open)dlg.showModal();
    const shows=await catalogue(city);
    render(name,find(shows,name));
    const c=dlg.querySelector('.si-close');if(c)c.focus();
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('.info-btn');
    if(!b)return;
    e.preventDefault();e.stopPropagation();
    const t=document.getElementById('showTip');if(t)t.classList.remove('on');
    open(b.dataset.info||'');
  },true);
  window.openShowInfo=open;
  window.showInfoLookup=lookup;
  document.addEventListener('mouseover',()=>{const c=currentCity();if(!loaded[c])lookup('')},{passive:true});
})();
</script>
`;
if (!s.includes("dlg.id='showInfo'")) s = s.replace('</body>', js + '</body>');

fs.writeFileSync(file, s);
console.log('Show info panel applied.');
