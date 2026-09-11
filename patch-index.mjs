import fs from 'node:fs';

const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

function mustReplace(search, replacement, label){
  if(!s.includes(search)){
    console.error(`Patch target not found: ${label}`);
    process.exit(1);
  }
  s = s.replace(search, replacement);
}

// Calendar detail styling.
mustReplace(
  '.calendar-choice b{display:block;font-size:11px;margin-bottom:2px}',
  '.calendar-choice b{display:block;font-size:11px;margin-bottom:2px}.calendar-time{font-weight:800;margin-bottom:2px}.calendar-venue{font-size:10px;font-weight:700;margin-top:3px}.calendar-address{font-size:9px;color:var(--muted);line-height:1.25;margin-top:2px}',
  'calendar CSS'
);

// Venue address directory. Live/API-supplied address takes priority over this lookup.
mustReplace(
  'function availableNames(){return new Set((current().schedule[state.active]||[]).map(([n])=>n))}',
  `const venueAddresses={
  london:{
    "His Majesty's Theatre":"57 Haymarket, London SW1Y 4QL, UK",
    "Sondheim Theatre":"51 Shaftesbury Avenue, London W1D 6BA, UK",
    "Novello Theatre":"Aldwych, London WC2B 4LD, UK",
    "Prince of Wales Theatre":"Coventry Street, London W1D 6AS, UK",
    "Lyceum Theatre":"21 Wellington Street, London WC2E 7RQ, UK",
    "Cambridge Theatre":"Earlham Street, London WC2H 9HU, UK",
    "Gielgud Theatre":"Shaftesbury Avenue, London W1D 6AR, UK",
    "ABBA Arena":"1 Pudding Mill Lane, London E15 2RU, UK",
    "Kit Kat Club at the Playhouse Theatre":"Northumberland Avenue, London WC2N 5DE, UK",
    "Playhouse Theatre":"Northumberland Avenue, London WC2N 5DE, UK",
    "Dominion Theatre":"268-269 Tottenham Court Road, London W1T 7AQ, UK",
    "Vaudeville Theatre":"404 Strand, London WC2R 0NH, UK",
    "Apollo Victoria Theatre":"17 Wilton Road, London SW1V 1LG, UK",
    "Piccadilly Theatre":"16 Denman Street, London W1D 7DY, UK",
    "Victoria Palace Theatre":"79 Victoria Street, London SW1E 5EA, UK",
    "Aldwych Theatre":"49 Aldwych, London WC2B 4DF, UK",
    "Lyric Theatre":"Shaftesbury Avenue, London W1D 7ES, UK",
    "Criterion Theatre":"218-223 Piccadilly, London SW1Y 4XA, UK",
    "Prince Edward Theatre":"Old Compton Street, London W1D 4HS, UK",
    "Noël Coward Theatre":"St Martin's Lane, London WC2N 4AU, UK",
    "Noel Coward Theatre":"St Martin's Lane, London WC2N 4AU, UK",
    "Troubadour Wembley Park Theatre":"Fulton Road, Wembley HA9 0SP, UK",
    "Shaftesbury Theatre":"210 Shaftesbury Avenue, London WC2H 8DP, UK",
    "Theatre Royal Drury Lane":"Catherine Street, London WC2B 5JF, UK",
    "Hampstead Theatre":"Eton Avenue, London NW3 3EU, UK",
    "Young Vic":"66 The Cut, London SE1 8LZ, UK",
    "Southwark Playhouse Elephant":"1 Dante Place, London SE11 4RX, UK",
    "Duke of York's Theatre":"St Martin's Lane, London WC2N 4BG, UK",
    "Charing Cross Theatre":"The Arches, Villiers Street, London WC2N 6NL, UK",
    "Savoy Theatre":"Savoy Court, Strand, London WC2R 0ET, UK",
    "Fortune Theatre":"Russell Street, London WC2B 5HH, UK"
  },
  broadway:{
    "New Amsterdam Theatre":"214 W 42nd St, New York, NY 10036, USA",
    "Stephen Sondheim Theatre":"124 W 43rd St, New York, NY 10036, USA",
    "Eugene O'Neill Theatre":"230 W 49th St, New York, NY 10019, USA",
    "Eugene O’Neill Theatre":"230 W 49th St, New York, NY 10019, USA",
    "Gerald Schoenfeld Theatre":"236 W 45th St, New York, NY 10036, USA",
    "Ambassador Theatre":"219 W 49th St, New York, NY 10019, USA",
    "Broadway Theatre":"1681 Broadway, New York, NY 10019, USA",
    "Walter Kerr Theatre":"219 W 48th St, New York, NY 10036, USA",
    "Richard Rodgers Theatre":"226 W 46th St, New York, NY 10036, USA",
    "Circle in the Square Theatre":"235 W 50th St, New York, NY 10019, USA",
    "Minskoff Theatre":"200 W 45th St, New York, NY 10036, USA",
    "Palace Theatre":"160 W 47th St, New York, NY 10036, USA",
    "Belasco Theatre":"111 W 44th St, New York, NY 10036, USA",
    "Neil Simon Theatre":"250 W 52nd St, New York, NY 10019, USA",
    "John Golden Theatre":"252 W 45th St, New York, NY 10036, USA",
    "Bernard B. Jacobs Theatre":"242 W 45th St, New York, NY 10036, USA",
    "Bernard B Jacobs Theatre":"242 W 45th St, New York, NY 10036, USA",
    "Studio 54":"254 W 54th St, New York, NY 10019, USA",
    "Nederlander Theatre":"208 W 41st St, New York, NY 10036, USA",
    "Lena Horne Theatre":"256 W 47th St, New York, NY 10036, USA",
    "Longacre Theatre":"220 W 48th St, New York, NY 10019, USA",
    "Gershwin Theatre":"222 W 51st St, New York, NY 10019, USA"
  }
};
function venueAddress(venue,meta={}){
  if(meta.address) return meta.address;
  const map=venueAddresses[state.city]||{};
  if(map[venue]) return map[venue];
  const key=Object.keys(map).find(k=>k.toLowerCase()===String(venue||'').toLowerCase());
  return key?map[key]:'';
}
function availableNames(){return new Set((current().schedule[state.active]||[]).map(([n])=>n))}`,
  'venue address directory'
);

// Save address with newly selected performances.
mustReplace(
  "choices()[state.active][session]={name,time,venue:m.venue||'',ticketUrl:m.ticketUrl||'',infoUrl:m.infoUrl||'',venueUrl:m.venueUrl||''};",
  "choices()[state.active][session]={name,time,venue:m.venue||'',address:venueAddress(m.venue||'',m),ticketUrl:m.ticketUrl||'',infoUrl:m.infoUrl||'',venueUrl:m.venueUrl||''};",
  'choice address persistence'
);

// Replace calendar renderer so every selected show displays time, theatre and address.
const calRe = /function renderCalendar\(\)\{[\s\S]*?\}\nfunction showTab/;
if(!calRe.test(s)){
  console.error('Patch target not found: renderCalendar');
  process.exit(1);
}
s = s.replace(calRe, `function calendarChoiceHtml(icon,c){
  if(!c)return'';
  const address=c.address||venueAddress(c.venue||'',c);
  return \`<div class="calendar-choice"><b>\${icon} \${esc(c.name)}</b><div class="calendar-time">\${esc(c.time)}</div><div class="calendar-venue">🎭 \${esc(c.venue||'Theater / Venue')}</div>\${address?\`<div class="calendar-address">📍 \${esc(address)}</div>\`:''}</div>\`;
}
function renderCalendar(){
  $('calendar').innerHTML='';
  let cur=new Date(parseISO(state.start).getFullYear(),parseISO(state.start).getMonth(),1,12),end=parseISO(state.end);
  while(cur<=end){
    const y=cur.getFullYear(),m=cur.getMonth(),sec=document.createElement('section');
    sec.className='month';
    sec.innerHTML=\`<div class="month-title">\${cur.toLocaleDateString('en-GB',{month:'long',year:'numeric'})} · \${esc(cityLabel())}</div><div class="weekdays">\${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(x=>\`<div>\${x}</div>\`).join('')}</div><div class="month-grid"></div>\`;
    const grid=sec.querySelector('.month-grid'),first=(new Date(y,m,1,12).getDay()+6)%7,total=new Date(y,m+1,0,12).getDate();
    for(let i=0;i<first;i++)grid.innerHTML+='<div class="day-cell out"></div>';
    for(let n=1;n<=total;n++){
      const d=iso(new Date(y,m,n,12)),inside=d>=state.start&&d<=state.end,cell=document.createElement('div');
      cell.className='day-cell '+(inside?'inrange':'out')+(d===state.active?' active':'');
      cell.innerHTML=\`<b>\${n}</b>\`;
      if(inside){
        const ch=choices()[d]||{};
        cell.innerHTML+=calendarChoiceHtml('☀️',ch.matinee)+calendarChoiceHtml('🌙',ch.evening);
        cell.onclick=()=>{state.active=d;showTab('schedule');renderDays();renderSidebar();renderDay();renderCalendar()};
      }
      grid.appendChild(cell);
    }
    $('calendar').appendChild(sec);
    cur=new Date(y,m+1,1,12);
  }
}
function showTab`);

// Add address to exported row model.
mustReplace(
  "venue:c.venue,ticket:c.ticketUrl||'',theatre:c.venueUrl||c.infoUrl||''",
  "venue:c.venue,address:c.address||venueAddress(c.venue||'',c),ticket:c.ticketUrl||'',theatre:c.venueUrl||c.infoUrl||''",
  'selectedRows address'
);

// Excel address column.
mustReplace(
  "const headers=['City','Date','Session','Start Time','Musical','Theater / Venue','Ticket Website','Theater / Venue Website'],keys=['city','date','session','time','musical','venue','ticket','theatre'];",
  "const headers=['City','Date','Session','Start Time','Musical','Theater / Venue','Address','Ticket Website','Theater / Venue Website'],keys=['city','date','session','time','musical','venue','address','ticket','theatre'];",
  'Excel address column'
);

// PDF address column.
mustReplace(
  "<th>Date</th><th>Session</th><th>Time</th><th>Musical</th><th>Theater / Venue</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.session)}</td><td>${esc(r.time)}</td><td>${esc(r.musical)}</td><td>${esc(r.venue)}</td></tr>`).join('')}</tbody>",
  "<th>Date</th><th>Session</th><th>Time</th><th>Musical</th><th>Theater / Venue</th><th>Address</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.session)}</td><td>${esc(r.time)}</td><td>${esc(r.musical)}</td><td>${esc(r.venue)}</td><td>${esc(r.address||'')}</td></tr>`).join('')}</tbody>",
  'PDF address column'
);

// Impact/SeatPlan ownership verification. Keep the exact tag supplied by Impact.
if(!s.includes('impact-site-verification')){
  s = s.replace('</head>', `<meta name='impact-site-verification' value='78f630d5-38a1-405a-ae8c-7c79dba75f93'>\n</head>`);
}

// Impact alternative content verification. Keep the exact text visible on the homepage.
const impactVerificationText = 'Impact-Site-Verification: 78f630d5-38a1-405a-ae8c-7c79dba75f93';
if(!s.includes(impactVerificationText)){
  s = s.replace('</body>', `<div style="font-size:10px;color:#6b665f;text-align:center;padding:4px 12px 14px">${impactVerificationText}</div>\n</body>`);
}

fs.writeFileSync(file,s);
console.log('Patched index.html with theater names, addresses, and Impact website verification.');
