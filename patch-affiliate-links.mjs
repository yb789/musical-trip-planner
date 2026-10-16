import fs from 'node:fs';

// Affiliate ticket buttons in the planner (2026-10-14, requested by Yuval).
// 1. "Tickets on SeatPlan" goes through SeatPlan's Impact tracking link (approved Oct 2026).
// 2. A "Tickets on Ticketmaster" button is added next to it when Ticketmaster sells that exact
//    performance. The link comes from /api/tm-link (licensed Discovery API, already wrapped in the
//    Impact link); it is fetched once per performance and cached in memory, and the card is
//    re-rendered when it arrives. No Ticketmaster match = no button.
// Runs after patch-seatplan-link.mjs. Exports (Excel cell, PDF link column) use the tracked link too.

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('AFFILIATE_LINKS_PATCH')) { console.log('patch-affiliate-links: already applied.'); process.exit(0); }

function mustReplace(search, replacement, label) {
  const n = s.split(search).length - 1;
  if (n !== 1) { console.error(`patch-affiliate-links: expected one match for "${label}", found ${n}`); process.exit(1); }
  s = s.replace(search, () => replacement);
}

const helpers = `/* AFFILIATE_LINKS_PATCH */
const SP_AFFILIATE='https://seatplan.sjv.io/c/7761524/2219054/28679';
function spTracked(url,name,src='planner'){if(!/^https?:\\/\\/([a-z0-9-]+\\.)*seatplan\\.com\\//i.test(url||''))return url;const sub=src+'-'+String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);return SP_AFFILIATE+'?u='+encodeURIComponent(url)+(sub!==src+'-'?'&subId1='+encodeURIComponent(sub):'')}
const tmLinks=new Map(),tmPending=new Set();
function tmKey(c,d){return [state.city,c.name,d,c.time].join('|')}
function tmLinkHtml(c,d){
  if(!c||!d)return'';const k=tmKey(c,d);
  if(tmLinks.has(k)){const u=tmLinks.get(k);return u?\`<a class="ticket-link tm-link" target="_blank" rel="noopener sponsored" href="\${esc(u)}">Tickets on Ticketmaster ↗</a>\`:''}
  if(!tmPending.has(k)){tmPending.add(k);const city=state.city;
    fetch('/api/tm-link?'+new URLSearchParams({city,name:c.name,date:d,time:c.time||''})).then(r=>r.ok?r.json():{url:''}).catch(()=>({url:''})).then(j=>{
      const u=String((j&&j.url)||'');tmLinks.set(k,/^https:\\/\\/ticketmaster\\.evyy\\.net\\//.test(u)?u:'');tmPending.delete(k);
      if(u&&state.city===city&&state.active===d){try{renderDay()}catch(e){}}
    });}
  return'';
}
function linkHtml(c){`;

mustReplace('function linkHtml(c){', helpers, 'linkHtml start');
// 2026-10-16 (Yuval): when SeatPlan or Ticketmaster sells the show, the "Theater / venue tickets"
// button is dropped; it only remains for shows neither seller lists.
mustReplace(
  'if(ticketUrl)h+=`<a class="ticket-link" target="_blank" rel="noopener" href="${esc(ticketUrl)}">Tickets on SeatPlan ↗</a>`;if(c.venueUrl||c.infoUrl)h+=`<a class="venue-link" target="_blank" rel="noopener" href="${esc(c.venueUrl||c.infoUrl)}">Theater / venue tickets ↗</a>`;return h}',
  'if(ticketUrl)h+=`<a class="ticket-link" target="_blank" rel="noopener sponsored" href="${esc(spTracked(ticketUrl,c.name))}">Tickets on SeatPlan ↗</a>`;const tmHtml=tmLinkHtml(c,state.active);h+=tmHtml;const venueUrl=c.venueUrl||c.infoUrl;if(venueUrl&&!ticketUrl&&!tmHtml)h+=`<a class="venue-link" target="_blank" rel="noopener" href="${esc(venueUrl)}">Theater / venue tickets ↗</a>`;return h}',
  'SeatPlan button + venue fallback'
);
// Ticketmaster blue so the two sellers are easy to tell apart. In the selected card the seller
// buttons are big blocks side by side, wrapping on narrow phones (2026-10-16); .card-links beats the ≤900px .ticket-link{font-size:12px} rule.
mustReplace(
  '.ticket-link{background:var(--accent)}',
  '.ticket-link{background:var(--accent)}.ticket-link.tm-link{background:#024ddf}.card-links{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.card-links .ticket-link,.card-links .venue-link{display:flex;align-items:center;justify-content:center;min-height:78px;flex:1 1 0;min-width:max-content;box-sizing:border-box;margin:0;padding:0 12px;font-size:14px;line-height:1.2;text-align:center;border-radius:12px;white-space:nowrap}',
  'tm css'
);

// Affiliate disclosure in the planner's ticket disclaimer (UK ASA/CAP and US FTC expect one).
mustReplace(
  'Ticket and venue links open independent third-party websites.',
  'Ticket and venue links open independent third-party websites. Some ticket links (SeatPlan, Ticketmaster) are affiliate links: we may earn a small commission if you book, at no extra cost to you, and it never affects which shows we suggest.',
  'disclosure'
);

// Exports (2026-10-16): the Excel "Ticket Website" cell and the PDF "Tickets" link also go through
// the SeatPlan tracking link, with subId1=export-<show> so Impact shows clicks from saved files.
// selectedRows() is overridden at runtime twice (date-calendar.js, then the ticket-confirmation
// wrapper, both inlined), so the effective place is the wrapper's row mapping.
mustReplace(
  "return {...row,bookingReference:choice?.bookingReference||'',seat:choice?.seat||'',ticketMatch:verification?verificationLabel(verification.status):''};",
  "return {...row,ticket:spTracked(choice?ticketLinkFor(choice):row.ticket,row.musical,'export'),ticketmaster:(choice&&tmExport.get(tmExportKey(choice,row.date)))||'',bookingReference:choice?.bookingReference||'',seat:choice?.seat||'',ticketMatch:verification?verificationLabel(verification.status):''};",
  'export ticket link'
);

// Ticketmaster in the exports too: the links are fetched for every chosen performance when
// "Finish planning" is pressed (the export panel opens after a confirmation, so they are ready),
// cached in tmExport and read by the row mapping above. Excel gets a "Tickets on Ticketmaster"
// column; the PDF (pdf-export.js) gets a second link column.
mustReplace(
  'function linkHtml(c){',
  `const tmExport=new Map();
function tmExportKey(c,dateLabel){return [state.city,dateLabel,c.name,c.time].join('|')}
function tmLinksForExport(){
  const jobs=[];
  for(const [d,day] of Object.entries(choices())){
    for(const sess of ['matinee','evening']){const c=day?.[sess];if(!c)continue;const k=tmExportKey(c,fmt(d));if(tmExport.has(k))continue;
      const cached=tmLinks.get(tmKey(c,d));if(cached!==undefined){tmExport.set(k,cached.replace(/([?&]subId1=)planner-/,'$1export-'));continue}
      jobs.push(fetch('/api/tm-link?'+new URLSearchParams({city:state.city,name:c.name,date:d,time:c.time||''})).then(r=>r.ok?r.json():{url:''}).catch(()=>({url:''})).then(j=>{const u=String((j&&j.url)||'');const ok=/^https:\\/\\/ticketmaster\\.evyy\\.net\\//.test(u)?u:'';tmExport.set(k,ok.replace(/([?&]subId1=)planner-/,'$1export-'));tmLinks.set(tmKey(c,d),ok)}));
    }
  }
  return Promise.all(jobs);
}
function linkHtml(c){`,
  'tm export helpers'
);
mustReplace(
  "$('finishBtn').onclick=()=>{",
  "$('finishBtn').onclick=()=>{try{tmLinksForExport()}catch(e){}",
  'finish prefetch'
);
mustReplace(
  "const headers=['City','Date','Session','Start Time','Musical','Theater / Venue','Address','Booking Confirmation','Seat','Ticket PDF Check','Ticket Website','Theater / Venue Website'];",
  "const headers=['City','Date','Session','Start Time','Musical','Theater / Venue','Address','Booking Confirmation','Seat','Ticket PDF Check','Tickets on SeatPlan','Tickets on Ticketmaster','Theater / Venue Website'];",
  'excel headers'
);
mustReplace(
  "const keys=['city','date','session','time','musical','venue','address','bookingReference','seat','ticketMatch','ticket','theatre'];",
  "const keys=['city','date','session','time','musical','venue','address','bookingReference','seat','ticketMatch','ticket','ticketmaster','theatre'];",
  'excel keys'
);

fs.writeFileSync(file, s);
console.log('patch-affiliate-links: SeatPlan tracking + Ticketmaster button applied (planner + exports).');
