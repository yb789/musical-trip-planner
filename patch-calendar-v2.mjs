import fs from 'node:fs';

const file='index.html';
let s=fs.readFileSync(file,'utf8');

// The first build patch creates calendarChoiceHtml. Replace it with a version
// that enriches old saved choices from the current live show metadata.
const calendarFn=/function calendarChoiceHtml\(icon,c\)\{[\s\S]*?\n\}/;
if(!calendarFn.test(s)){
  console.error('calendarChoiceHtml not found after first patch');
  process.exit(1);
}

s=s.replace(calendarFn,`function calendarChoiceHtml(icon,c){
  if(!c)return'';
  const meta=showMeta(c.name)||{};
  const venue=c.venue||meta.venue||'Theater / Venue';
  const address=c.address||meta.address||venueAddress(venue,meta);
  // Calendar intentionally does not render ticket price or price fields.
  return \`<div class="calendar-choice"><b>\${icon} \${esc(c.name)}</b><div class="calendar-time">\${esc(c.time)}</div><div class="calendar-venue">🎭 \${esc(venue)}</div>\${address?\`<div class="calendar-address">📍 \${esc(address)}</div>\`:''}</div>\`;
}`);

// Make exported rows enrich old saved choices too, and do not add a price column.
const selectedRows=/function selectedRows\(\)\{[\s\S]*?\n\}/;
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
      const meta=showMeta(c.name)||{};
      const venue=c.venue||meta.venue||'';
      const address=c.address||meta.address||venueAddress(venue,meta);
      rows.push({
        city:cityLabel(),
        date:fmt(d),
        session:sess==='matinee'?'Matinee / Afternoon':'Evening',
        time:c.time,
        musical:c.name,
        venue,
        address,
        ticket:c.ticketUrl||meta.ticketUrl||'',
        theatre:c.venueUrl||c.infoUrl||meta.venueUrl||meta.infoUrl||''
      });
    }
  }
  return rows;
}`);

// Defensive rule: if a future source adds a price element to a calendar entry,
// never show it in My Calendar.
if(!s.includes('.calendar-price{display:none!important}')){
  s=s.replace('</style>','.calendar-price{display:none!important}\n</style>');
}

fs.writeFileSync(file,s);
console.log('Calendar v2 applied: theater + address shown, price omitted.');
