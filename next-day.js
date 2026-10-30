// "Next day" in the Finish planning bar (2026-10-30, requested by Yuval).
// While some trip days have no show chosen (neither matinee nor evening), the bar shows
// "N days without a show yet" and a Next day button: a click goes to the next such day after the
// one on screen (wrapping round); hovering (or the ▾ on touch screens) opens a list of every open
// day to jump to. When every day has a show the bar says so and only Finish planning remains.
// Days on which nothing is listed are not counted. Inlined by patch-next-day.mjs.
(function(){
  const wrap=document.getElementById('nextDayWrap');
  const hint=document.getElementById('finishHint');
  if(!wrap||!hint)return;
  const DEFAULT_HINT=hint.innerHTML;
  const label=d=>fmt(d,{weekday:'short',day:'numeric',month:'short'});

  function openDays(){
    let data;try{data=current()}catch(e){return null}
    if(!data||!data.schedule||!state.start||!state.end)return null;
    const ch=choices()||{};
    return days().filter(d=>{const c=ch[d]||{};return !c.matinee&&!c.evening&&(data.schedule[d]||[]).length});
  }
  function nextAfter(list){
    const later=list.find(d=>d>state.active);
    return later||list.find(d=>d!==state.active)||null;
  }
  function goTo(d){
    state.active=d;
    try{if(typeof showTab==='function')showTab('schedule')}catch(e){}
    renderDays();
    try{renderSidebar()}catch(e){}
    renderDay();
    try{renderCalendar()}catch(e){}
    closeMenu();
    const strip=document.getElementById('dayStrip');
    if(strip)strip.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function closeMenu(){wrap.classList.remove('open');const t=wrap.querySelector('.next-day-toggle');if(t)t.setAttribute('aria-expanded','false')}

  function update(){
    const list=openDays();
    if(list===null){wrap.innerHTML='';hint.innerHTML=DEFAULT_HINT;return}
    if(!list.length){
      wrap.innerHTML='';
      hint.innerHTML='<b class="all-days-done">✓ You have shows on all selected dates.</b><br>Book your tickets, export or share your plan.';
      return;
    }
    const n=list.length;
    hint.innerHTML=`<b>${n} day${n===1?'':'s'} without a show yet.</b><br>Choose shows, or finish whenever you're ready.`;
    const next=nextAfter(list);
    if(!next){ // the only open day is the one on screen
      wrap.innerHTML='';
      hint.innerHTML=`<b>${esc(label(state.active))} has no show yet.</b><br>Choose one above, or finish whenever you're ready.`;
      return;
    }
    const wasOpen=wrap.classList.contains('open');
    wrap.innerHTML=`<button type="button" class="next-day-btn" title="Go to ${esc(label(next))}">Next day <span class="next-day-date">${esc(label(next))}</span> →</button>`+
      `<button type="button" class="next-day-toggle" aria-label="Show all days without a show" aria-haspopup="true" aria-expanded="${wasOpen}">▾</button>`+
      `<div class="next-day-menu" role="menu"><div class="next-day-menu-title">Days without a show</div>${list.map(d=>`<button type="button" role="menuitem" data-date="${esc(d)}" class="${d===state.active?'current':''}">${esc(label(d))}${d===state.active?' <span>(this day)</span>':''}</button>`).join('')}</div>`;
    wrap.querySelector('.next-day-btn').onclick=()=>goTo(next);
    wrap.querySelector('.next-day-toggle').onclick=e=>{e.stopPropagation();const o=!wrap.classList.contains('open');wrap.classList.toggle('open',o);e.currentTarget.setAttribute('aria-expanded',String(o))};
    wrap.querySelectorAll('.next-day-menu [data-date]').forEach(b=>b.onclick=()=>goTo(b.dataset.date));
  }

  document.addEventListener('click',e=>{if(!wrap.contains(e.target))closeMenu()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});

  // Every choice change, day switch and schedule load ends in renderDays(), so update after it.
  const previousRenderDays=renderDays;
  renderDays=function(){previousRenderDays.apply(this,arguments);try{update()}catch(e){console.error(e)}};
  update();
})();
