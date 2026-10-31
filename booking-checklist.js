// "Book your tickets" (2026-10-30, requested by Yuval after visitor feedback).
// Problem: the big seller buttons on the chosen card looked like the next planning step, and the
// ticket site pulled visitors away mid-plan with no easy way back.
// Now:
//  - the chosen card only has a small "Buy tickets ↗" link (for people who want to buy right away);
//  - after "Finish planning" the panel lists every chosen performance with its seller buttons and
//    "Mark as booked" (a simple flag on the choice; a confirmation PDF/reference also counts as booked);
//  - every route to a ticket site goes through a short "Leaving the planner" dialog that says the
//    plan stays saved, and when the visitor comes back to the tab a toast asks whether they booked.
// Inlined by patch-booking-checklist.mjs after the main script, so it can use the planner globals
// (state, choices, fmt, esc, tmLinks, tmKey, tmLinkHtml, ticketLinkFor, officialTicketFor, spTracked...).
(function(){
  const SESSION_LABEL={matinee:'Matinee',evening:'Evening'};
  let lastLeave=null; // {city,date,session,seller} of the last ticket-site visit

  function choiceAt(date,session){return state.choices?.[state.city]?.[date]?.[session]||null}
  function isBooked(c){return !!(c&&(c.booked||c.bookingReference))}
  function shortDate(d){return fmt(d,{weekday:'short',day:'numeric',month:'short'})}
  function title(c){return typeof cleanShowTitle==='function'?cleanShowTitle(c.name):c.name}
  function venueOf(c){try{return c.venue||showMeta(c.name).venue||''}catch(e){return c.venue||''}}
  function priceOf(c,d){
    try{const e=(current().schedule[d]||[]).find(x=>x[0]===c.name&&x[1]===c.time);const m=e&&e[2];
      if(m&&m.soldOut)return 'Sold out on '+(PRICE_SRC[state.city]||'the listing');return m&&m.from?'from '+m.from:'';}catch(e){return ''}
  }
  function partOf(c,d){try{return typeof partLabel==='function'?partLabel(c.name,c.time,d):''}catch(e){return ''}}

  // Where this performance can be bought. src tags the affiliate subId (planner- / book-).
  function sellers(c,d,src){
    const out=[];if(!c)return out;
    const sp=typeof ticketLinkFor==='function'?ticketLinkFor(c):'';
    if(sp)out.push({id:'seatplan',name:'SeatPlan',cls:'',url:spTracked(sp,c.name,src),sponsored:true});
    if(typeof tmLinkHtml==='function')tmLinkHtml(c,d); // starts the Ticketmaster lookup if needed
    const tm=typeof tmLinks!=='undefined'?tmLinks.get(tmKey(c,d)):'';
    if(tm)out.push({id:'ticketmaster',name:'Ticketmaster',cls:'tm-link',url:tm.replace(/([?&]subId1=)planner-/,'$1'+src+'-'),sponsored:true});
    if(!out.length){
      const official=typeof officialTicketFor==='function'?officialTicketFor(c):'';
      if(official)out.push({id:'official',name:'the official ticket site',label:'Official tickets',cls:'official',url:official});
      else{const v=c.venueUrl||c.infoUrl;if(v)out.push({id:'venue',name:'the theatre website',label:'Theatre website',cls:'venue-link',url:v})}
    }
    return out;
  }
  function sellerLabel(s){return s.label||s.name}

  // ---- Chosen card: one small link instead of the big seller buttons ----
  window.mhBuyLinkHtml=function(c,d,session){
    if(!c)return '';
    const booked=isBooked(c);
    const list=sellers(c,d,'planner');
    let h='';
    if(booked)h+='<span class="card-booked">✓ Booked</span>';
    if(list.length)h+=`<button type="button" class="buy-link" data-date="${esc(d)}" data-session="${esc(session)}">${booked?'Ticket sites':'Buy tickets'} ↗</button>`;
    if(!booked&&list.length)h+='<span class="buy-hint">or book them all when you finish planning</span>';
    return h;
  };

  // ---- "Leaving the planner" dialog ----
  function ensureLeaveOverlay(){
    let o=document.getElementById('leaveOverlay');if(o)return o;
    o=document.createElement('div');o.id='leaveOverlay';o.className='overlay hidden';
    o.innerHTML='<div class="modal leave-modal" role="dialog" aria-modal="true" aria-labelledby="leaveTitle"><h2 id="leaveTitle">Buy tickets</h2><div id="leaveShow" class="leave-show"></div><div id="leaveSellers" class="leave-sellers"></div><p class="small leave-note">The ticket site opens in a <b>new tab</b>; this tab with your plan stays open behind it. When you have booked, switch back to this tab and press <b>Mark as booked</b>. If you lose it, just open <b>musicaltripplanner.com</b> again: your plan reopens where you left it.</p><div class="actions"><button type="button" id="leaveStay">Stay and keep planning</button></div></div>';
    document.body.appendChild(o);
    o.addEventListener('click',e=>{if(e.target===o)closeLeave()});
    o.querySelector('#leaveStay').onclick=closeLeave;
    return o;
  }
  function closeLeave(){const o=document.getElementById('leaveOverlay');if(o)o.classList.add('hidden')}
  function openLeave(date,session,onlySeller){
    const c=choiceAt(date,session);if(!c)return;
    const src=onlySeller?'book':'planner';
    let list=sellers(c,date,src);
    if(onlySeller)list=list.filter(s=>s.id===onlySeller);
    if(!list.length)return;
    const o=ensureLeaveOverlay();
    const part=partOf(c,date);
    o.querySelector('.leave-modal').dataset.show=c.name;
    o.querySelector('#leaveShow').innerHTML=`<b data-show="${esc(c.name)}">${esc(title(c))}</b>${part?` · ${esc(part)}`:''}<br>${esc(fmt(date))} · ${esc(SESSION_LABEL[session]||'')} ${esc(c.time||'')}${venueOf(c)?`<br>${esc(venueOf(c))}`:''}`;
    o.querySelector('#leaveSellers').innerHTML=list.map(s=>`<a class="ticket-link ${s.cls}" target="_blank" rel="noopener${s.sponsored?' sponsored':''}" href="${esc(s.url)}" data-seller="${esc(s.id)}">Continue to ${esc(sellerLabel(s))} ↗</a>`).join('');
    o.querySelectorAll('#leaveSellers a').forEach(a=>{a.addEventListener('click',()=>{
      lastLeave={city:state.city,date,session,seller:a.dataset.seller,at:Date.now()};
      setTimeout(closeLeave,50);
    })});
    o.classList.remove('hidden');
    const first=o.querySelector('#leaveSellers a');if(first)first.focus();
  }
  window.mhOpenLeave=openLeave;

  // ---- Coming back to the tab ----
  function ensureToast(){
    let t=document.getElementById('bookToast');if(t)return t;
    t=document.createElement('div');t.id='bookToast';t.className='book-toast hidden';t.setAttribute('role','status');
    document.body.appendChild(t);return t;
  }
  function hideToast(){const t=document.getElementById('bookToast');if(t)t.classList.add('hidden')}
  function welcomeBack(){
    const l=lastLeave;if(!l||l.city!==state.city||Date.now()-l.at<1500)return;
    lastLeave=null;
    const c=choiceAt(l.date,l.session);if(!c)return;
    const t=ensureToast();
    if(isBooked(c)){t.innerHTML='<span>Welcome back. Your plan is saved.</span><button type="button" class="book-toast-close" aria-label="Close">✕</button>'}
    else t.innerHTML=`<span>Welcome back, your plan is saved. Did you book <b>${esc(title(c))}</b> (${esc(shortDate(l.date))})?</span><button type="button" class="primary book-toast-yes">Yes, mark as booked</button><button type="button" class="book-toast-no">Not yet</button>`;
    t.classList.remove('hidden');
    const yes=t.querySelector('.book-toast-yes');if(yes)yes.onclick=()=>{markBooked(l.date,l.session,true);hideToast()};
    t.querySelectorAll('.book-toast-no,.book-toast-close').forEach(b=>b.onclick=hideToast);
    const row=document.querySelector(`.book-row[data-date="${l.date}"][data-session="${l.session}"]`);
    if(row){row.classList.add('just-back');setTimeout(()=>row.classList.remove('just-back'),4000)}
    clearTimeout(welcomeBack.timer);welcomeBack.timer=setTimeout(hideToast,20000);
  }
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')welcomeBack()});
  window.addEventListener('focus',welcomeBack);

  // ---- Booked flag ----
  function markBooked(date,session,on){
    const c=choiceAt(date,session);if(!c)return;
    if(on){c.booked=true;try{window.mtpTrack&&mtpTrack('booked_marked',{show:String(c.name).slice(0,80)})}catch(e){}}
    else delete c.booked;
    save();
    try{renderDay()}catch(e){}
    try{renderCalendar()}catch(e){}
    renderBookList();
  }

  // ---- The checklist in the Finish planning panel ----
  function rows(){
    // Only the current trip's dates: choices from earlier trips or dates stay in localStorage.
    const out=[];const all=choices()||{};
    const inTrip=d=>typeof isTripDate==='function'?isTripDate(d):(d>=state.start&&d<=state.end);
    for(const d of Object.keys(all).sort())if(inTrip(d))for(const session of ['matinee','evening']){const c=all[d]?.[session];if(c)out.push({d,session,c})}
    return out;
  }
  function renderBookList(){
    const box=document.getElementById('bookList');if(!box)return;
    const list=rows();
    if(!list.length){box.innerHTML='<p class="small">No performances chosen yet.</p>';return}
    const done=list.filter(r=>isBooked(r.c)).length;
    let h=`<div class="book-progress"><b>${done} of ${list.length}</b> booked${done===list.length?' — all set, enjoy the shows!':''}<span class="book-bar"><span style="width:${Math.round(100*done/list.length)}%"></span></span></div><ol class="book-rows">`;
    for(const {d,session,c} of list){
      const booked=isBooked(c);const part=partOf(c,d);const price=booked?'':priceOf(c,d);
      const sl=booked?[]:sellers(c,d,'book');
      const buy=sl.map(s=>`<button type="button" class="book-seller ticket-link ${s.cls}" data-seller="${esc(s.id)}">${esc(sellerLabel(s))} ↗</button>`).join('');
      let status;
      if(c.bookingReference)status=`<span class="book-badge">✓ Booked · ${esc(c.bookingReference)}${c.seat?` · Seat ${esc(c.seat)}`:''}</span><button type="button" class="book-confirm">Edit confirmation</button>`;
      else if(booked)status=`<span class="book-badge">✓ Booked</span><button type="button" class="book-confirm">Add confirmation</button><button type="button" class="book-undo">Undo</button>`;
      else status=`<button type="button" class="book-mark">Mark as booked</button>`;
      h+=`<li class="book-row${booked?' booked':''}" data-date="${esc(d)}" data-session="${esc(session)}"><div class="book-info"><div class="book-when">${esc(shortDate(d))} · ${esc(SESSION_LABEL[session])} ${esc(c.time||'')}${part?` · ${esc(part)}`:''}</div><div class="book-show" data-show="${esc(c.name)}">${esc(title(c))}${typeof kindPill==='function'?kindPill(c.name):''}${price?` <span class="book-price">${esc(price)}</span>`:''}</div>${venueOf(c)?`<div class="book-venue">${esc(venueOf(c))}</div>`:''}</div><div class="book-actions">${buy}${status}</div></li>`;
    }
    h+='</ol>';
    box.innerHTML=h;
    box.querySelectorAll('.book-row').forEach(row=>{
      const d=row.dataset.date,session=row.dataset.session;
      row.querySelectorAll('.book-seller').forEach(b=>b.onclick=()=>openLeave(d,session,b.dataset.seller));
      const mark=row.querySelector('.book-mark');if(mark)mark.onclick=()=>markBooked(d,session,true);
      const undo=row.querySelector('.book-undo');if(undo)undo.onclick=()=>markBooked(d,session,false);
      const conf=row.querySelector('.book-confirm');if(conf)conf.onclick=()=>{if(typeof window.mhOpenTicketModal==='function')window.mhOpenTicketModal(d,session)};
    });
  }
  window.mhRenderBookList=renderBookList;

  // Re-render when the confirmation dialog closes (a saved reference counts as booked).
  function watchTicketModal(){
    const o=document.getElementById('ticketConfirmationOverlay');if(!o||o.dataset.bookWatch)return;
    o.dataset.bookWatch='1';
    new MutationObserver(()=>{if(o.classList.contains('hidden'))renderBookList()}).observe(o,{attributes:true,attributeFilter:['class']});
  }

  // Finish planning → "Yes, I'm finished": fill the checklist, then again when Ticketmaster links arrive.
  const finishYes=document.getElementById('finishYes');
  if(finishYes){
    const prev=finishYes.onclick;
    finishYes.onclick=function(e){
      if(prev)prev.call(this,e);
      renderBookList();watchTicketModal();
      try{Promise.resolve(tmLinksForExport()).then(renderBookList,renderBookList)}catch(err){}
    };
  }

  // Chosen card's "Buy tickets ↗" link (cards are re-rendered often, so the click is delegated).
  document.addEventListener('click',e=>{
    const b=e.target&&e.target.closest?e.target.closest('.buy-link'):null;
    if(b){e.preventDefault();openLeave(b.dataset.date,b.dataset.session,null)}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeLeave()});

  // ---- Getting back to the plan (2026-10-30, Yuval) ----
  // The planner keeps chosen shows but not the trip dates, so coming back (Back button, a phone that
  // opened the ticket site in place, reopening the site) used to land on the opening screen and ask
  // for dates again. The trip is now remembered; within 6 hours of leaving from "Book your tickets"
  // the site reopens straight into that list, otherwise the date dialog offers "Resume my trip".
  const TRIP_KEY='musicalPlannerTrip',BOOKING_RESUME_MS=6*60*60*1000;
  function readTrip(){try{const t=JSON.parse(localStorage.getItem(TRIP_KEY)||'null');return t&&t.city&&/^\d{4}-\d{2}-\d{2}$/.test(t.start||'')&&/^\d{4}-\d{2}-\d{2}$/.test(t.end||'')?t:null}catch(e){return null}}
  function writeTrip(extra){
    if(!state.start||!state.end||!state.city)return;
    try{const prev=readTrip()||{};const same=prev.city===state.city&&prev.start===state.start&&prev.end===state.end;
      localStorage.setItem(TRIP_KEY,JSON.stringify({city:state.city,start:state.start,end:state.end,booking:same?!!prev.booking:false,at:same?prev.at||0:0,...(extra||{})}))}catch(e){}
  }
  function tripChoices(t){const all=(state.choices&&state.choices[t.city])||{};return Object.keys(all).filter(d=>d>=t.start&&d<=t.end&&all[d]&&(all[d].matinee||all[d].evening)).length}
  const todayISO=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
  function resumable(t){return t&&t.end>=todayISO()&&tripChoices(t)>0}
  async function resumeTrip(t,openBooking){
    if(typeof window.mhApplyPlan!=='function')return;
    await window.mhApplyPlan({city:t.city,ranges:[{start:t.start,end:t.end}]});
    if(location.hash!=='#/plan')location.hash='#/plan';
    if(openBooking){
      try{$('finishConfirm').classList.add('hidden');$('exportPanel').classList.remove('hidden');$('finishOverlay').classList.remove('hidden')}catch(e){}
      renderBookList();watchTicketModal();
      try{Promise.resolve(tmLinksForExport()).then(renderBookList,renderBookList)}catch(e){}
    }
  }

  // Remember the trip whenever the day strip is drawn (dates chosen, shows chosen…).
  const prevRenderDays=renderDays;
  renderDays=function(){prevRenderDays.apply(this,arguments);writeTrip()};
  // Opening "Book your tickets" marks the trip for automatic reopening; going back to the planner clears that.
  const fy=document.getElementById('finishYes');
  if(fy){const p=fy.onclick;fy.onclick=function(e){if(p)p.call(this,e);writeTrip({booking:true,at:Date.now()})}}
  const rb=document.getElementById('returnBtn');
  if(rb){const p=rb.onclick;rb.onclick=function(e){if(p)p.call(this,e);writeTrip({booking:false,at:0})}}

  // "Resume my trip" in the date dialog's saved-selection notice.
  function addResumeButton(t){
    const notice=document.getElementById('savedNotice');if(!notice||document.getElementById('resumeTripBtn'))return;
    const actions=notice.querySelector('.actions');if(!actions)return;
    const city=t.city==='london'?'London':'Broadway';
    const range=fmt(t.start,{day:'numeric',month:'short'})+(t.end!==t.start?' – '+fmt(t.end,{day:'numeric',month:'short'}):'');
    const b=document.createElement('button');b.id='resumeTripBtn';b.type='button';b.className='primary';
    b.textContent=`Resume my trip: ${city}, ${range}`;
    b.onclick=()=>resumeTrip(t,false);
    actions.prepend(b);
    const clear=document.getElementById('savedClear');
    if(clear)clear.addEventListener('click',()=>{b.remove();try{localStorage.removeItem(TRIP_KEY)}catch(e){}});
    const keep=document.getElementById('savedKeep');
    if(keep)keep.textContent='Keep them, pick new dates';
  }

  (async function onLoad(){
    const params=new URLSearchParams(location.search);
    if(params.has('plan')||params.has('city')||window.MH_SHARED_PLAN)return; // shared plans and show-page links win
    const t=readTrip();
    if(!resumable(t))return;
    if(t.booking&&Date.now()-(t.at||0)<BOOKING_RESUME_MS){
      try{await resumeTrip(t,true)}catch(e){console.error(e)}
      return;
    }
    addResumeButton(t);
  })();
})();
