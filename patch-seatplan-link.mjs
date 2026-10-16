import fs from 'node:fs';

// The "Ticket website" button now opens SeatPlan. The API already returns a SeatPlan
// ticketUrl for every show; this patch also makes selections saved by older versions
// of the site (which stored London Box Office / Broadway.com links) use the freshly
// loaded SeatPlan link whenever the show is present in the live schedule.

const file='index.html';
let s=fs.readFileSync(file,'utf8');

const oldLink=`function linkHtml(c){if(!c)return'';let h='';if(c.ticketUrl)h+=\`<a class="ticket-link" target="_blank" rel="noopener" href="\${esc(c.ticketUrl)}">Ticket website ↗</a>\`;`;
const newLink=`function ticketLinkFor(c){
  const live=showMeta(c.name)||{};
  const liveUrl=String(live.ticketUrl||'');
  const isShowPage=u=>/seatplan\\.com\\/(london|new-york)\\/[^/?#]+/i.test(u);
  if(isShowPage(liveUrl))return liveUrl;
  const saved=String(c.ticketUrl||'');
  if(isShowPage(saved))return saved;
  return '';
}
// Where to buy when SeatPlan doesn't sell the show: the guide's official page, else the listing site's own booking link.
function officialTicketFor(c){
  const g=typeof window.mhGuideEntry==='function'?window.mhGuideEntry(c.name):null;
  if(g&&g.tickets)return g.tickets;
  const live=showMeta(c.name)||{};
  const src=String(live.sourceTicketUrl||'');
  return /^https?:\\/\\//.test(src)&&!/seatplan\\.com/i.test(src)?src:'';
}
function linkHtml(c){if(!c)return'';let h='';const ticketUrl=ticketLinkFor(c);if(ticketUrl)h+=\`<a class="ticket-link" target="_blank" rel="noopener" href="\${esc(ticketUrl)}">Tickets on SeatPlan ↗</a>\`;`;

if(!s.includes(oldLink)){
  console.error('Patch target not found: linkHtml');
  process.exit(1);
}
s=s.replace(oldLink,newLink);

// Export rows: use the SeatPlan link too.
s=s.replaceAll("ticket:c.ticketUrl||loc.meta.ticketUrl||''","ticket:ticketLinkFor(c)||officialTicketFor(c)");
s=s.replaceAll("ticket:c.ticketUrl||''","ticket:ticketLinkFor(c)||officialTicketFor(c)");

fs.writeFileSync(file,s);
console.log('SeatPlan ticket link applied.');
