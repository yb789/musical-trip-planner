// Own usage counter: sends small anonymous beacons to /api/event (no cookies, no IP stored).
// Counts: page views (with the referring site's host name), dates chosen, finished, exports, share,
// ticket (affiliate) clicks, shared plan opened. The server adds the visitor's country from Vercel's
// geolocation header; the IP address itself is never stored.
// Opt out on this browser: open any page with ?notrack=1 (undo with ?notrack=0). Used to keep the
// owner's own visits out of the numbers.
(function(){
  var off=false;try{var q=location.search.match(/[?&]notrack=([01])\b/);if(q){if(q[1]==='1')localStorage.setItem('mtpNoTrack','1');else localStorage.removeItem('mtpNoTrack')}off=localStorage.getItem('mtpNoTrack')==='1'}catch(e){}
  if(off){window.mtpTrack=function(){};return}
  var city=function(){try{var c=(window.state&&state.city)||document.body.dataset.city||'';if(!c){var m=location.pathname.match(/^\/(london|new-york)\b/);c=m?(m[1]==='new-york'?'broadway':'london'):''}return c==='new-york'?'broadway':c}catch(e){return ''}};
  function send(event,extra){try{var b=JSON.stringify(Object.assign({event:event,page:location.pathname,city:city()},extra||{}));if(navigator.sendBeacon){navigator.sendBeacon('/api/event',new Blob([b],{type:'application/json'}))}else{fetch('/api/event',{method:'POST',headers:{'Content-Type':'application/json'},body:b,keepalive:true}).catch(function(){})}}catch(e){}}
  window.mtpTrack=send;
  var buttons={continueBtn:'dates_chosen',finishYes:'finished',excelBtn:'export_excel',pdfBtn:'export_pdf',icsBtn:'export_ics',shareBtn:'share_open',shareBtn2:'share_open'};
  document.addEventListener('click',function(e){
    var t=e.target&&e.target.closest?e.target.closest('button,a'):null;if(!t)return;
    if(t.id&&buttons[t.id])send(buttons[t.id]);
    if(t.tagName==='A'&&t.href){var h='';try{var lu=new URL(t.href);h=lu.hostname;if(lu.pathname==='/go'&&lu.searchParams.get('u'))h=new URL(lu.searchParams.get('u')).hostname}catch(x){}
      var seller=/sjv\.io$|seatplan\.com$/.test(h)?'seatplan':/evyy\.net$|ticketmaster\./.test(h)?'ticketmaster':'';
      if(seller){var card=t.closest('.show-card,article,.cta,[data-show]');var el=card&&(card.querySelector('[data-show]')||card.querySelector('.show-title,h1,h2,h3'));var show=(el&&(el.dataset.show||el.textContent))||(document.querySelector('main h1,h1')||{}).textContent||'';send('ticket_click',{seller:seller,show:String(show).trim().slice(0,80)})}}
  },true);
  var ref='';try{if(document.referrer){var rh=new URL(document.referrer).hostname;if(rh!==location.hostname)ref=rh}}catch(e){}
  send('pageview',{ref:ref});
  if(/[?&]plan=/.test(location.search)||window.MH_SHARED_PLAN)send('plan_opened');
})();
