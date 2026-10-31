// Own usage counter: sends small anonymous beacons to /api/event (no cookies, no IP stored).
// Counts: dates chosen, finished, exports, share, ticket (affiliate) clicks, shared plan opened.
(function(){
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
  if(/[?&]plan=/.test(location.search)||window.MH_SHARED_PLAN)send('plan_opened');
})();
