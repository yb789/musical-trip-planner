import fs from 'node:fs';

const file='index.html';
let s=fs.readFileSync(file,'utf8');

const calendarFn=/function calendarChoiceHtml\(icon,c\)\{[\s\S]*?\n\}/;
if(!calendarFn.test(s)){
  console.error('calendarChoiceHtml not found after first patch');
  process.exit(1);
}

s=s.replace(calendarFn,`const showVenueFallback={
  broadway:{
    "aladdin":"New Amsterdam Theatre",
    "& juliet":"Stephen Sondheim Theatre",
    "the book of mormon":"Eugene O'Neill Theatre",
    "buena vista social club":"Gerald Schoenfeld Theatre",
    "chicago":"Ambassador Theatre",
    "the great gatsby":"Broadway Theatre",
    "hadestown":"Walter Kerr Theatre",
    "hamilton":"Richard Rodgers Theatre",
    "just in time":"Circle in the Square Theatre",
    "the lion king":"Minskoff Theatre",
    "the lost boys":"Palace Theatre",
    "maybe happy ending":"Belasco Theatre",
    "mj":"Neil Simon Theatre",
    "operation mincemeat: a new musical":"John Golden Theatre",
    "the outsiders":"Bernard B. Jacobs Theatre",
    "the rocky horror show":"Studio 54",
    "schmigadoon!":"Nederlander Theatre",
    "six: the musical":"Lena Horne Theatre",
    "two strangers (carry a cake across new york)":"Longacre Theatre",
    "wicked":"Gershwin Theatre"
  },
  london:{
    "the phantom of the opera":"His Majesty's Theatre",
    "les misérables":"Sondheim Theatre",
    "mamma mia!":"Novello Theatre",
    "the book of mormon":"Prince of Wales Theatre",
    "the lion king":"Lyceum Theatre",
    "matilda the musical":"Cambridge Theatre",
    "oliver!":"Gielgud Theatre",
    "abba voyage":"ABBA Arena",
    "cabaret":"Kit Kat Club at the Playhouse Theatre",
    "the devil wears prada":"Dominion Theatre",
    "six the musical":"Vaudeville Theatre",
    "wicked":"Apollo Victoria Theatre",
    "moulin rouge! the musical":"Piccadilly Theatre",
    "hamilton":"Victoria Palace Theatre",
    "hadestown":"Lyric Theatre",
    "paddington the musical":"Savoy Theatre",
    "operation mincemeat":"Fortune Theatre"
  }
};
function fallbackVenueForShow(name){
  let key=String(name||'').replace(/\\s+/g,' ').trim();
  key=key.replace(/\\s+from\\s+(?:US)?\\$[\\d,.]+.*$/i,'').replace(/\\s+save(?:\\s+up\\s+to)?\\s+(?:US)?\\$[\\d,.]+.*$/i,'').trim().toLowerCase();
  return (showVenueFallback[state.city]||{})[key]||'';
}
function resolveVenueAndAddress(c){
  const meta=showMeta(c.name)||{};
  const fallbackVenue=fallbackVenueForShow(c.name);
  let venue=c.venue||meta.venue||fallbackVenue||'';
  if(!venue || /^Broadway, New York$/i.test(venue) || /^London · West End$/i.test(venue)) venue=fallbackVenue||venue;
  const address=c.address||meta.address||venueAddress(venue,meta)||'';
  return {meta,venue,address};
}
function calendarChoiceHtml(icon,c){
  if(!c)return'';
  const loc=resolveVenueAndAddress(c);
  return \`<div class="calendar-choice"><b>\${icon} \${esc(c.name)}</b><div class="calendar-time">\${esc(c.time)}</div><div class="calendar-venue">🎭 \${esc(loc.venue||'Theater / Venue')}</div>\${loc.address?\`<div class="calendar-address">📍 \${esc(loc.address)}</div>\`:''}</div>\`;
}`);

const selectedRows=/function selectedRows\(\)\{[\s\S]*?\}(?=\nfunction exportExcel)/;
if(!selectedRows.test(s)){
  console.error('selectedRows not found');
  process.exit(1);
}

s=s.replace(selectedRows,`function selectedRows(){
  const rows=[];
  for(const d of Object.keys(choices()).sort()){
    if(d<state.start||d>state.end)continue;
    for(const sess of ['matinee','evening']){
      const c=choices()[d]?.[sess];
      if(!c)continue;
      const loc=resolveVenueAndAddress(c);
      rows.push({
        city:cityLabel(),
        date:fmt(d),
        session:sess==='matinee'?'Matinee / Afternoon':'Evening',
        time:c.time,
        musical:c.name,
        venue:loc.venue,
        address:loc.address,
        ticket:c.ticketUrl||loc.meta.ticketUrl||'',
        theatre:c.venueUrl||c.infoUrl||loc.meta.venueUrl||loc.meta.infoUrl||''
      });
    }
  }
  return rows;
}`);

if(!s.includes('.calendar-price{display:none!important}')){
  s=s.replace('</style>','.calendar-price{display:none!important}\n</style>');
}

fs.writeFileSync(file,s);
console.log('Calendar/PDF location fallback applied.');
