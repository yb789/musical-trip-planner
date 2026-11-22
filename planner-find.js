// "Find a show" inside the planner (Yuval, 22 Nov 2026; step 2 of the show search).
// Above the calendar: type a show's name and see every performance of it on the trip's days.
// Tapping a time puts that performance in the plan (same path as the Choose buttons, so the
// "already selected" and "tight timing" questions still appear). The days it plays are outlined on
// the calendar. A show whose type is switched off (a play, say) or that was unticked in the filter
// is still found, with one button to bring it back. A show that is in the guide but not on these
// dates says so and links to its page. Matching is shared with the opening-screen box
// (static/show-search.js, window.mtpShowSearch.find). Inlined by patch-planner-find.mjs.
(function(){
  const $=id=>document.getElementById(id);
  const box=$('pfBox'),input=$('pfInput'),out=$('pfResults');
  if(!box||!input||!out)return;
  const MAX=4;
  const day=d=>fmt(d,{weekday:'short',day:'numeric',month:'short'});
  const squash=v=>String(v||'').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,'');
  const track=(ev,show)=>{try{if(window.mtpTrack)window.mtpTrack(ev,{show})}catch(e){}};
  let marked=[],seq=0,lastNone='',noneTimer=0;

  const loaded=()=>!!(state.start&&state.end&&current()&&current().schedule&&Object.keys(current().schedule).length);
  // Every show with a performance on a trip day: name -> [{d,t}], whatever its type or the filter.
  function tripShows(){
    const m=new Map(),sch=current().schedule;
    for(const d of days())for(const [n,t] of (sch[d]||[])){if(!m.has(n))m.set(n,[]);m.get(n).push({d,t})}
    for(const list of m.values())list.sort((a,b)=>a.d.localeCompare(b.d)||mins(a.t)-mins(b.t));
    return m;
  }
  const inPlanAt=(name,d,t)=>{const ch=choices()[d]||{};return MH_SESSIONS.some(k=>ch[k]&&ch[k].name===name&&ch[k].time===t)};
  const excluded=name=>(state.excluded[state.city]||new Set()).has(name);

  function mark(dates){
    marked=dates||[];
    document.querySelectorAll('#planCal .pc-day.pf-hit').forEach(n=>n.classList.remove('pf-hit'));
    for(const d of marked){const n=document.querySelector(`#planCal .pc-day[data-date="${d}"]`);if(n)n.classList.add('pf-hit')}
  }
  function showCard(name,perfs){
    const g=guideFor(name),venue=(showMeta(name).venue)||(g&&g.venue)||'';
    const allowed=kindAllowed(name),ex=excluded(name);
    let note='';
    if(!allowed){
      const b=typeof window.mhKindBoxFor==='function'?window.mhKindBoxFor(name):null;
      note=b?`<div class="pf-note">“${esc(b.label)}” is switched off in your planner, so this show is not on the calendar. <button type="button" class="pf-on" data-kind="${esc(b.id)}">Show ${esc(b.label)}</button></div>`
        :'<div class="pf-note">This type of show is switched off in your planner.</div>';
    }else if(ex)note=`<div class="pf-note">You unticked this show in the filter, so it is not on the calendar. <button type="button" class="pf-tick" data-name="${esc(name)}">Tick it back</button></div>`;
    const byDay=new Map();
    for(const p of perfs){if(!byDay.has(p.d))byDay.set(p.d,[]);byDay.get(p.d).push(p.t)}
    const rows=[...byDay].map(([d,times])=>`<div class="pf-day"><span class="pf-date">${esc(day(d))}</span><span class="pf-times">${times.map(t=>{
      const on=inPlanAt(name,d,t),part=typeof partLabel==='function'?partLabel(name,t,d):'';
      return `<button type="button" class="pf-time${on?' on':''}" data-name="${esc(name)}" data-date="${d}" data-time="${esc(t)}"${on||!allowed||ex?' disabled':''} aria-label="${on?'In your plan: ':'Add '}${esc(cleanShowTitle(name))}, ${esc(day(d))} at ${esc(t)}">${on?'✓ ':''}${esc(t)}${part?' · '+esc(part):''}</button>`;
    }).join('')}</span></div>`).join('');
    const n=byDay.size;
    return `<article class="pf-show" data-show-name="${esc(name)}"><div class="pf-show-head"><b class="pf-title" data-show="${esc(name)}" translate="no">${esc(cleanShowTitle(name))}</b>${kindPill(name)}${venue?`<span class="pf-venue">${esc(venue)}</span>`:''}</div>
      <div class="pf-sum">Plays on ${n} of your ${days().length} day${days().length===1?'':'s'}. ${allowed&&!ex?'Tap a time to add it to your plan.':''}</div>${note}<div class="pf-days">${rows}</div></article>`;
  }
  function draw(html,status){
    out.innerHTML=html;out.hidden=!html;
    $('pfStatus').textContent=status||'';
  }
  function render(){
    clearTimeout(noneTimer);
    box.hidden=!loaded();
    const text=input.value,mine=++seq;
    if(box.hidden||squash(text).length<2||!window.mtpShowSearch){draw('','');mark([]);$('pfHint').hidden=true;return}
    const trip=tripShows();
    const items=[...trip.keys()].map(name=>{const g=guideFor(name);return {name,title:cleanShowTitle(name),match:[squash(name),...(g?[squash(g.title),...(g.match||[])]:[])],familiar:!!(g&&g.familiar)}});
    const hits=window.mtpShowSearch.find(items,text).slice(0,MAX);
    if(hits.length){
      draw(hits.map(h=>showCard(h.name,trip.get(h.name))).join(''),`${hits.length} show${hits.length===1?'':'s'} found on your dates`);
      // One show found, and it is on the calendar: outline its days there.
      const one=hits.length===1&&kindAllowed(hits[0].name)&&!excluded(hits[0].name);
      mark(one?[...new Set(trip.get(hits[0].name).map(p=>p.d))]:[]);
      $('pfHint').hidden=!one;
      return;
    }
    mark([]);$('pfHint').hidden=true;
    // Not on these dates: is it in the guide at all?
    window.mtpShowSearch._search(text,state.city).then(found=>{
      if(mine!==seq)return;
      const here=found.filter(s=>s.city===state.city)[0],there=found.filter(s=>s.city!==state.city)[0];
      const place=c=>c==='london'?'London':'New York';
      if(here)draw(`<div class="pf-msg"><b translate="no">${esc(here.title)}</b> has no performances listed on your dates${here.ended?' (its run has ended)':here.upcoming?' (it has not opened yet)':''}. <a href="${esc(here.href)}">See its page for other dates</a>, or <button type="button" class="pf-link" id="pfDates">change your dates</button>.</div>`,'Not playing on your dates');
      else if(there)draw(`<div class="pf-msg"><b translate="no">${esc(there.title)}</b> plays in ${place(there.city)}; this plan is for ${place(state.city)}. <a href="${esc(there.href)}">See its page</a>.</div>`,'Plays in the other city');
      else{
        draw(`<div class="pf-msg">No show called “${esc(text.trim())}” on your dates or in our guide. Check the spelling, or open the filter below to see everything that is playing.</div>`,'No shows found');
        const said=String(text).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().slice(0,40);
        if(said.length>=3&&said!==lastNone)noneTimer=setTimeout(()=>{lastNone=said;track('show_search_none',said)},1500);
      }
      const b=$('pfDates');if(b)b.onclick=()=>{const c=$('changeDatesBtn');if(c)c.click()};
    },()=>{});
  }

  input.addEventListener('input',render);
  input.addEventListener('keydown',e=>{if(e.key==='Escape'&&input.value){e.preventDefault();e.stopPropagation();input.value='';render()}});
  $('pfClear').onclick=()=>{input.value='';render();input.focus()};
  out.addEventListener('click',e=>{
    const t=e.target.closest('button');if(!t)return;
    if(t.classList.contains('pf-time')){
      if(t.disabled)return;
      const {name,date,time}=t.dataset;
      state.active=date;
      try{renderDays()}catch(x){}
      track('show_search',cleanShowTitle(name));
      attemptChoice(name,time); // asks first when the show is already in the plan or the timing is tight
    }else if(t.classList.contains('pf-on')){
      if(typeof window.mhSetKind==='function')window.mhSetKind(t.dataset.kind,true);
      render();
    }else if(t.classList.contains('pf-tick')){
      state.excluded[state.city].delete(t.dataset.name);
      save();renderSidebar();renderDay();
    }
  });
  // Keep the results and the calendar outlines in step with the plan.
  const prevRenderDay=renderDay;
  renderDay=function(...a){const r=prevRenderDay.apply(this,a);try{render()}catch(e){console.error(e)}return r};
  const cal=$('planCal');
  if(cal&&window.MutationObserver)new MutationObserver(()=>{if(marked.length&&!cal.querySelector('.pc-day.pf-hit'))mark(marked)}).observe(cal,{childList:true});
  document.addEventListener('mh-kinds-change',()=>{try{render()}catch(e){}});
  render();
  window.mhPlannerFind={render};
})();
