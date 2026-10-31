// Calendar-first planning (2026-10-31, requested by Yuval).
// After choosing dates the planner opens on a calendar of the trip: every day has a Matinee and an
// Evening slot, plus a Morning slot (starts before 12:00) or a Late slot (from 21:30) on days that
// have such performances. Pressing a slot opens a pop-up with the shows playing then; choosing one
// fills the slot. Shows already in the plan elsewhere are marked in the lists (pop-up and day view),
// and choosing one again asks for confirmation (the existing duplicate dialog). The show filter sits
// at the top of the planner and covers the whole trip; "Change dates" is in the planner header.
// The old day-by-day list stays as the second tab. Inlined by patch-calendar-planner.mjs (last).
(function(){
  const $=id=>document.getElementById(id);
  const SLOT_INFO={
    morning:{icon:'🌅',label:'Morning',hint:'Starts before 12:00'},
    matinee:{icon:'☀️',label:'Matinee',hint:'Starts 12:00 – 16:59'},
    evening:{icon:'🌙',label:'Evening',hint:'Starts 17:00 – 21:29'},
    late:{icon:'🌌',label:'Late',hint:'Starts 21:30 or later'}
  };
  const shortDay=d=>fmt(d,{weekday:'short',day:'numeric',month:'short'});
  let open=null; // {date, slot} of the pop-up

  // ---- Tight timing (2026-10-31, Yuval) ----
  // Two chosen shows on one day are "tight" when the later one starts less than TRAVEL minutes
  // after the earlier one is expected to end (different theatres), and "overlapping" when it starts
  // before that. End = start + guide running time (per part for two-part shows; 2h30 if unknown).
  const TRAVEL=30;
  const hhmm=m=>`${String(Math.floor(m/60)%24).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const vkey=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'').replace(/theatre|theater/g,'');
  function runOf(name,time,date){
    const g=typeof guideFor==='function'?guideFor(name):null,r=g&&g.runtime;
    const part=typeof partLabel==='function'?partLabel(name,time,date):'';
    const m=window.mhIcs&&window.mhIcs.runtimeMinutes?window.mhIcs.runtimeMinutes(r,part):150;
    return {mins:m||150,est:!r};
  }
  function venueFor(name,c){
    if(c&&c.venue)return c.venue;
    const g=typeof guideFor==='function'?guideFor(name):null;
    return (g&&g.venue)||((typeof showMeta==='function'&&showMeta(name).venue)||'');
  }
  // Clashes between a show at `time` and the other choices of `date` (skipKey = the slot it would replace).
  function clashes(date,name,time,skipKey){
    const ch=choices()[date]||{},out=[],me={name,time,venue:venueFor(name),run:runOf(name,time,date)};
    for(const k of MH_SESSIONS){
      if(k===skipKey)continue;
      const c=ch[k];if(!c||(c.name===name&&c.time===time))continue;
      const other={name:c.name,time:c.time,venue:venueFor(c.name,c),run:runOf(c.name,c.time,date)};
      const [first,second]=mins(other.time)<=mins(me.time)?[other,me]:[me,other];
      const end=mins(first.time)+first.run.mins,gap=mins(second.time)-end;
      const same=!!first.venue&&vkey(first.venue)===vkey(second.venue);
      if(gap<0||(!same&&gap<TRAVEL))out.push({first,second,end,gap,overlap:gap<0,same});
    }
    return out;
  }
  function clashText(x,html=true){
    const b=v=>html?`<b>${esc(cleanShowTitle(v))}</b>`:cleanShowTitle(v),e=v=>html?esc(v):v;
    const est=x.first.run.est?' (estimated; its running time is not listed)':'';
    if(x.overlap)return `${b(x.first.name)} (${e(x.first.time)}) ends at about ${hhmm(x.end)}${est}, but ${b(x.second.name)} starts at ${e(x.second.time)}: the times overlap by ${-x.gap} minutes.`;
    return `${b(x.first.name)} (${e(x.first.time)}) ends at about ${hhmm(x.end)}${est}, and ${b(x.second.name)} starts at ${e(x.second.time)}${x.second.venue?` at ${e(x.second.venue)}`:''}: only ${x.gap} minutes to leave one theatre and reach the other.`;
  }
  function ensureTight(){
    let o=$('tightOverlay');if(o)return o;
    o=document.createElement('div');o.id='tightOverlay';o.className='overlay hidden';
    o.setAttribute('role','alertdialog');o.setAttribute('aria-modal','true');o.setAttribute('aria-labelledby','tightTitle');
    o.innerHTML='<div class="modal"><h2 id="tightTitle">⚠ Tight timing</h2><div id="tightText"></div><p class="small">End times are estimates from published running times. Curtain calls, exit queues and getting across town can take longer, so leave at least '+TRAVEL+' minutes between theatres.</p><div class="actions"><button type="button" id="tightNo">Pick another show</button><button type="button" id="tightYes" class="primary">Choose anyway</button></div></div>';
    document.body.appendChild(o);
    return o;
  }
  let tightOk=false;
  function askTight(name,time,list){
    const o=ensureTight();
    $('tightTitle').textContent=list.some(x=>x.overlap)?'⚠ These shows overlap':'⚠ Tight timing';
    $('tightText').innerHTML=list.map(x=>`<p>${clashText(x)}</p>`).join('');
    o.classList.remove('hidden');
    $('tightNo').onclick=()=>{o.classList.add('hidden')};
    $('tightYes').onclick=()=>{o.classList.add('hidden');tightOk=true;commitChoice(name,time)};
    $('tightNo').focus({preventScroll:true});
  }
  // Notes on the cards of a list: which start times would be tight with the day's other choices.
  function markTight(container,date){
    if(!container)return;
    container.querySelectorAll('.show-card').forEach(card=>{
      card.querySelectorAll('.pc-tight').forEach(n=>n.remove());
      const t=card.querySelector('.show-title[data-show]');if(!t)return;
      const notes=[];
      card.querySelectorAll('.pick:not(.selected)').forEach(b=>{
        for(const x of clashes(date,b.dataset.name,b.dataset.time,sessionOf(b.dataset.time))){
          const other=x.first.name===b.dataset.name&&x.first.time===b.dataset.time?x.second:x.first;
          const n=`${x.overlap?'Overlaps':'Tight with'} ${cleanShowTitle(other.name)} ${other.time}`+(x.overlap?'':` (${x.gap} min)`);
          if(!notes.includes(n))notes.push(n);
        }
      });
      if(notes.length)(card.querySelector('.show-venue')||t).insertAdjacentHTML('afterend',`<div class="pc-tight">⚠ ${esc(notes.join(' · '))}</div>`);
    });
  }

  function entriesFor(date){
    const ex=state.excluded[state.city]||new Set();
    return ((current()&&current().schedule[date])||[])
      .filter(([n])=>!ex.has(n)&&kindAllowed(n))
      .sort((a,b)=>mins(a[1])-mins(b[1])||a[0].localeCompare(b[0]));
  }
  // The slot a saved choice sits in: its key (older plans keep 11:00 shows under "matinee").
  function slotsForDay(date,list){
    const ch=choices()[date]||{},out=[];
    for(const k of MH_SESSIONS){
      const n=list.filter(e=>sessionOf(e[1])===k).length;
      if(k==='matinee'||k==='evening'||n||ch[k])out.push({k,n,c:ch[k]});
    }
    return out;
  }
  // Every place a show is in the plan (trip dates only).
  function inPlan(name){
    const out=[],all=choices()||{};
    for(const d of Object.keys(all).sort()){
      if(d<state.start||d>state.end)continue;
      for(const k of MH_SESSIONS){const c=all[d]&&all[d][k];if(c&&c.name===name)out.push({d,k,c})}
    }
    return out;
  }
  function slotHtml(date,s){
    const i=SLOT_INFO[s.k],lbl=`<span class="pc-slot-lbl">${i.icon} ${i.label}</span>`;
    if(s.c){
      const booked=s.c.booked||s.c.bookingReference;
      const cl=clashes(date,s.c.name,s.c.time,s.k);
      const warn=cl.length?`<span class="pc-slot-warn" title="${esc(cl.map(x=>clashText(x,false)).join(' '))}">⚠ ${cl.some(x=>x.overlap)?'Overlaps another show':'Tight timing'}</span>`:'';
      return `<button type="button" class="pc-slot filled${cl.length?' tight':''}" data-date="${date}" data-slot="${s.k}" data-kind="${esc(s.c.kind||kindOfShow(s.c.name))}" title="Change or remove the ${i.label.toLowerCase()} show">${lbl}<b class="pc-slot-show">${esc(cleanShowTitle(s.c.name))}</b><span class="pc-slot-time">${esc(s.c.time)}${partLabel(s.c.name,s.c.time,date)?' · '+partLabel(s.c.name,s.c.time,date):''}${booked?' · <span class="pc-booked">✓ Booked</span>':''}</span>${warn}</button>`;
    }
    if(!s.n)return `<div class="pc-slot none">${lbl}<span class="pc-slot-add">No ${i.label.toLowerCase()} shows</span></div>`;
    return `<button type="button" class="pc-slot empty" data-date="${date}" data-slot="${s.k}" title="See the ${s.n} ${i.label.toLowerCase()} show${s.n===1?'':'s'}">${lbl}<span class="pc-slot-add">+ Choose · ${s.n} show${s.n===1?'':'s'}</span></button>`;
  }

  function renderPlanCal(){
    const host=$('planCal');if(!host)return;
    const head=$('pcTrip');
    if(!state.start||!state.end){host.innerHTML='';if(head)head.textContent='No dates chosen yet';return}
    if(head)head.textContent=`${state.city==='london'?'London · West End':'New York · Broadway'} · ${fmt(state.start,{weekday:'short',day:'numeric',month:'short'})} – ${fmt(state.end,{weekday:'short',day:'numeric',month:'short',year:'numeric'})}`;
    const trip=days();if(!trip.length){host.innerHTML='';return}
    // Whole weeks, Monday to Sunday, covering the trip.
    let d=trip[0];while(parseISO(d).getDay()!==1)d=addDays(d,-1);
    let last=trip[trip.length-1];while(parseISO(last).getDay()!==0)last=addDays(last,1);
    const loaded=!!(current()&&current().schedule&&Object.keys(current().schedule).length);
    let html=`<div class="pc-weekdays">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>`<div>${x}</div>`).join('')}</div><div class="pc-grid">`;
    for(let g=0;d<=last&&g<70;g++,d=addDays(d,1)){
      const x=parseISO(d),inTrip=d>=state.start&&d<=state.end;
      const num=`<div class="pc-date"><span class="pc-wd">${x.toLocaleDateString('en-GB',{weekday:'short'})}</span> <b>${x.getDate()}</b>${x.getDate()===1||d===trip[0]?` <span class="pc-mon">${x.toLocaleDateString('en-GB',{month:'short'})}</span>`:''}</div>`;
      if(!inTrip){html+=`<div class="pc-day out">${num}</div>`;continue}
      const list=entriesFor(d),any=(current().schedule[d]||[]).length;
      let body;
      if(!loaded)body='<div class="pc-empty-day">Loading…</div>';
      else if(!any)body='<div class="pc-empty-day">No performances listed</div>';
      else body=slotsForDay(d,list).map(s=>slotHtml(d,s)).join('');
      const filled=MH_SESSIONS.some(k=>(choices()[d]||{})[k]);
      html+=`<div class="pc-day${filled?' has-show':''}${d===state.active?' active':''}" data-date="${d}">${num}<div class="pc-slots">${body}</div></div>`;
    }
    html+='</div>';
    host.innerHTML=html;
    host.querySelectorAll('button.pc-slot').forEach(b=>b.onclick=()=>openSlot(b.dataset.date,b.dataset.slot));
  }

  // Marks every card whose show is already in the plan somewhere else.
  function markInPlan(container,date){
    if(!container)return;
    container.querySelectorAll('.show-card').forEach(card=>{
      const t=card.querySelector('.show-title[data-show]');if(!t)return;
      const times=[...card.querySelectorAll('.pick')].map(b=>b.dataset.time);
      const where=inPlan(t.dataset.show).filter(p=>!(p.d===date&&times.includes(p.c.time)));
      card.querySelectorAll('.pc-inplan').forEach(n=>n.remove());
      card.classList.toggle('pc-in-plan',where.length>0);
      if(!where.length)return;
      const txt=where.slice(0,3).map(p=>`${shortDay(p.d)} · ${SLOT_INFO[p.k].label} ${esc(p.c.time)}`).join('; ')+(where.length>3?` and ${where.length-3} more`:'');
      const box=card.querySelector('.show-venue')||t;
      box.insertAdjacentHTML('afterend',`<div class="pc-inplan">★ Already in your plan: ${txt}</div>`);
    });
  }

  function renderPopupList(){
    if(!open)return;
    const {date,slot}=open,i=SLOT_INFO[slot];
    $('pcModalDate').textContent=fmt(date);
    $('pcModalTitle').textContent=`${i.icon} ${i.label}`;
    $('pcModalHint').textContent=i.hint+'. Choose one show for this slot; a show already in your plan is marked ★.';
    const list=entriesFor(date).filter(e=>sessionOf(e[1])===slot);
    const ch=choices()[date]||{};
    // A saved choice under this key that the filter now hides still needs a way to remove it.
    let extra='';
    if(ch[slot]&&!list.some(e=>e[0]===ch[slot].name&&e[1]===ch[slot].time))
      extra=`<div class="pc-hidden-choice">Your choice <b>${esc(cleanShowTitle(ch[slot].name))}</b> · ${esc(ch[slot].time)} is hidden by the show filter. <button type="button" class="danger" id="pcRemoveHidden">Remove it</button></div>`;
    $('pcList').innerHTML=extra+(list.length?cards(list):`<div class="empty">No ${i.label.toLowerCase()} performances on this day for the shows you kept.</div>`);
    const rm=$('pcRemoveHidden');if(rm)rm.onclick=()=>{deselectChoice(slot)};
  }
  function openSlot(date,slot){
    open={date,slot};
    state.active=date;
    $('pcOverlay').classList.remove('hidden');
    document.body.classList.add('pc-modal-open');
    try{renderDays()}catch(e){}
    renderDay(); // renders the pop-up list first, then binds Choose buttons and decorations
    const m=$('pcOverlay').querySelector('.modal');if(m)m.scrollTop=0;
    $('pcClose').focus({preventScroll:true});
  }
  function closeSlot(){
    if(!open)return;
    const was=open;open=null;
    $('pcOverlay').classList.add('hidden');
    document.body.classList.remove('pc-modal-open');
    $('pcList').innerHTML='';
    const b=document.querySelector(`.pc-slot[data-date="${was.date}"][data-slot="${was.slot}"]`);
    if(b){b.classList.add('pc-flash');setTimeout(()=>b.classList.remove('pc-flash'),1200)}
  }

  // ---- hooks into the existing planner ----
  const prevRenderDay=renderDay;
  renderDay=function(...a){
    renderPopupList();
    const r=prevRenderDay.apply(this,a);
    try{
      markInPlan($('matineeList'),state.active);markInPlan($('eveningList'),state.active);
      if(open){markInPlan($('pcList'),open.date);markTight($('pcList'),open.date)}
      markTight($('matineeList'),state.active);markTight($('eveningList'),state.active);
      // Day-by-day summary: the extra Morning / Late choices.
      const ch=choices()[state.active]||{},line=(k,c)=>`<div class="pc-extra-choice">${SLOT_INFO[k].label}: <b data-show="${esc(c.name)}">${esc(cleanShowTitle(c.name))}</b>${kindPill(c.name)} · ${esc(c.time)}</div>`;
      if(ch.morning&&$('matineeChoice'))$('matineeChoice').insertAdjacentHTML('afterbegin',line('morning',ch.morning));
      if(ch.late&&$('eveningChoice'))$('eveningChoice').insertAdjacentHTML('beforeend',line('late',ch.late));
      renderPlanCal();
    }catch(e){console.error(e)}
    return r;
  };
  const prevCommit=commitChoice;
  commitChoice=function(name,time,...rest){
    if(!tightOk){
      const list=clashes(state.active,name,time,sessionOf(time));
      if(list.length){askTight(name,time,list);return}
    }
    tightOk=false;
    const r=prevCommit.call(this,name,time,...rest);
    closeSlot();
    return r;
  };

  // Trip-wide show filter: every show playing on any trip day.
  availableNames=function(){
    const s=new Set();
    for(const d of days())for(const [n] of ((current()&&current().schedule[d])||[]))if(kindAllowed(n))s.add(n);
    return s;
  };
  const prevSidebar=renderSidebar;
  renderSidebar=function(...a){
    const r=prevSidebar.apply(this,a);
    try{
      const kinds=typeof window.mhExtraKinds==='function'&&window.mhExtraKinds()?'shows':'musicals';
      $('sidebarTitle').textContent=`${state.city==='london'?'London':'Broadway'} ${kinds} on your trip dates`;
      const c=$('availableCount');if(c)c.textContent=c.textContent.replace('available on this date','on your trip dates');
      const l=$('sidebarToggleLabel');if(l)l.textContent=l.textContent.replace(/^Filter musicals/,`Filter ${kinds}`);
      if(!$('musicalList').querySelector('.musical-row')&&state.start)$('musicalList').innerHTML=`<div class="empty">No ${kinds} are listed for your dates yet.</div>`;
    }catch(e){console.error(e)}
    return r;
  };

  // Tabs: Calendar (default) | Day by day. "My calendar" is folded into the new calendar.
  showTab=function(which){
    const p=which!=='schedule';
    $('planCalView').classList.toggle('active',p);$('planCalTab').classList.toggle('active',p);
    $('scheduleView').classList.toggle('active',!p);$('scheduleTab').classList.toggle('active',!p);
    $('calendarView').classList.remove('active');$('calendarTab').classList.remove('active');
    document.body.classList.toggle('pc-mode',p);
    try{localStorage.setItem('musicalPlannerView',p?'calendar':'schedule')}catch(e){}
    if(p)renderPlanCal();
  };
  $('planCalTab').onclick=()=>showTab('calendar');
  $('scheduleTab').onclick=()=>showTab('schedule');
  $('pcDatesBtn').onclick=()=>{const b=$('changeDatesBtn');if(b)b.click()};
  $('pcClose').onclick=closeSlot;
  $('pcOverlay').addEventListener('click',e=>{if(e.target===$('pcOverlay'))closeSlot()});
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!open)return;
    // Leave Escape to a dialog opened on top (duplicate / deselect confirmation).
    if([...document.querySelectorAll('.overlay:not(.hidden)')].some(o=>o.id!=='pcOverlay'))return;
    closeSlot();
  });
  let initial='calendar';try{initial=localStorage.getItem('musicalPlannerView')||'calendar'}catch(e){}
  showTab(initial);
  window.mhRenderPlanCal=renderPlanCal;
  window.mhOpenSlot=openSlot;
})();
