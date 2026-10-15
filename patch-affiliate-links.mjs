import fs from 'node:fs';

// Affiliate ticket buttons in the planner (2026-10-14, requested by Yuval).
// 1. "Tickets on SeatPlan" goes through SeatPlan's Impact tracking link (approved Oct 2026).
// 2. A "Tickets on Ticketmaster" button is added next to it when Ticketmaster sells that exact
//    performance. The link comes from /api/tm-link (licensed Discovery API, already wrapped in the
//    Impact link); it is fetched once per performance and cached in memory, and the card is
//    re-rendered when it arrives. No Ticketmaster match = no button.
// Runs after patch-seatplan-link.mjs. Exports (PDF/Excel) keep the plain SeatPlan link.

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
function spTracked(url,name){if(!/^https?:\\/\\/([a-z0-9-]+\\.)*seatplan\\.com\\//i.test(url||''))return url;const sub='planner-'+String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);return SP_AFFILIATE+'?u='+encodeURIComponent(url)+(sub!=='planner-'?'&subId1='+encodeURIComponent(sub):'')}
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
mustReplace(
  'if(ticketUrl)h+=`<a class="ticket-link" target="_blank" rel="noopener" href="${esc(ticketUrl)}">Tickets on SeatPlan ↗</a>`;',
  'if(ticketUrl)h+=`<a class="ticket-link" target="_blank" rel="noopener sponsored" href="${esc(spTracked(ticketUrl,c.name))}">Tickets on SeatPlan ↗</a>`;h+=tmLinkHtml(c,state.active);',
  'SeatPlan button'
);
// Ticketmaster blue so the two sellers are easy to tell apart.
mustReplace(
  '.ticket-link{background:var(--accent)}',
  '.ticket-link{background:var(--accent)}.ticket-link.tm-link{background:#024ddf}',
  'tm css'
);

// Affiliate disclosure in the planner's ticket disclaimer (UK ASA/CAP and US FTC expect one).
mustReplace(
  'Ticket and venue links open independent third-party websites.',
  'Ticket and venue links open independent third-party websites. Some ticket links (SeatPlan, Ticketmaster) are affiliate links: we may earn a small commission if you book, at no extra cost to you, and it never affects which shows we suggest.',
  'disclosure'
);

fs.writeFileSync(file, s);
console.log('patch-affiliate-links: SeatPlan tracking + Ticketmaster button applied.');
