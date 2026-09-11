import fs from 'node:fs';

const file='index.html';
let s=fs.readFileSync(file,'utf8');

function replaceOrFail(search,replacement,label){
  if(!s.includes(search)){
    console.error(`Patch target not found: ${label}`);
    process.exit(1);
  }
  s=s.replace(search,replacement);
}

// Add a strong display-name cleaner and make metadata lookup ignore any
// Broadway.com price / savings suffix that leaked into a show title.
replaceOrFail(
  "function days(){const out=[];let d=state.start,g=0;while(d<=state.end&&g++<31){out.push(d);d=addDays(d,1)}return out}function cityLabel(){return state.city==='london'?'London · West End':'New York · Broadway'}function cityShort(){return state.city==='london'?'London musicals':'Broadway musicals'}function current(){return state.data[state.city]}function choices(){return state.choices[state.city]}function showMeta(name){return current().shows.find(s=>s.name===name)||{name,venue:cityLabel()}}",
  `function days(){const out=[];let d=state.start,g=0;while(d<=state.end&&g++<31){out.push(d);d=addDays(d,1)}return out}function cityLabel(){return state.city==='london'?'London · West End':'New York · Broadway'}function cityShort(){return state.city==='london'?'London musicals':'Broadway musicals'}function current(){return state.data[state.city]}function choices(){return state.choices[state.city]}
function cleanShowTitle(name){
  let x=String(name||'').replace(/\\s+/g,' ').trim();
  // Broadway.com can append strings such as:
  // "from $64.01 Save $77.75" or "from $79.36" to the title.
  // Everything from that pricing suffix onward is intentionally removed.
  const priceAt=x.search(/\\s+from\\s+(?:US)?\\$[\\d,.]+/i);
  if(priceAt>0)x=x.slice(0,priceAt);
  const saveAt=x.search(/\\s+save(?:\\s+up\\s+to)?\\s+(?:US)?\\$[\\d,.]+/i);
  if(saveAt>0)x=x.slice(0,saveAt);
  return x.trim();
}
function showMeta(name){
  const wanted=cleanShowTitle(name).toLowerCase();
  return current().shows.find(s=>cleanShowTitle(s.name).toLowerCase()===wanted)||{name:cleanShowTitle(name),venue:cityLabel()};
}`,
  'cleanShowTitle/showMeta'
);

// Force a fresh CDN cache key after the title-cleaning fix. The server ignores
// this extra query parameter; it exists only to avoid an older cached response.
replaceOrFail(
  "fetch(`/api/schedule?city=${encodeURIComponent(state.city)}&start=${state.start}&end=${state.end}`)",
  "fetch(`/api/schedule?city=${encodeURIComponent(state.city)}&start=${state.start}&end=${state.end}&titleclean=4`)",
  'schedule cache buster'
);

// Sanitize the live response itself before any part of the interface sees it.
// This protects the app even if an upstream source or stale API response still
// contains pricing text in the title. Existing saved selections are migrated too.
replaceOrFail(
  "state.data[state.city]={shows:data.shows,schedule:data.schedule};const perf=Object.values(data.schedule).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);",
  `const cleanedShowMap=new Map();
    for(const show of data.shows){
      const cleanName=cleanShowTitle(show.name);
      if(!cleanName)continue;
      const previous=cleanedShowMap.get(cleanName);
      cleanedShowMap.set(cleanName,{...(previous||{}),...show,name:cleanName});
    }
    const cleanedShows=[...cleanedShowMap.values()];
    const cleanedSchedule={};
    for(const [date,entries] of Object.entries(data.schedule||{})){
      const seen=new Set();
      cleanedSchedule[date]=(Array.isArray(entries)?entries:[])
        .map(([name,time])=>[cleanShowTitle(name),time])
        .filter(([name,time])=>{
          if(!name)return false;
          const key=name.toLowerCase()+'|'+time;
          if(seen.has(key))return false;
          seen.add(key);
          return true;
        });
    }
    state.data[state.city]={shows:cleanedShows,schedule:cleanedSchedule};
    // Migrate saved choices made before the price-cleaning fix.
    for(const cityKey of ['london','broadway']){
      for(const day of Object.values(state.choices[cityKey]||{})){
        for(const session of ['matinee','evening']){
          if(day?.[session]?.name)day[session].name=cleanShowTitle(day[session].name);
        }
      }
    }
    save();
    const perf=Object.values(cleanedSchedule).reduce((n,a)=>n+(Array.isArray(a)?a.length:0),0);`,
  'sanitize live API response'
);

// Clean names in the left-hand musical list.
replaceOrFail(
  "<label for=\"${id}\"><b>${esc(s.name)}</b><div class=\"venue-mini\">${esc(s.venue||'')}</div></label>",
  "<label for=\"${id}\"><b>${esc(cleanShowTitle(s.name))}</b><div class=\"venue-mini\">${esc(s.venue||'')}</div></label>",
  'sidebar show title'
);

// Clean names on the performance cards.
replaceOrFail(
  "<div class=\"show-title\">${esc(name)}</div>",
  "<div class=\"show-title\">${esc(cleanShowTitle(name))}</div>",
  'performance card show title'
);

// Clean names in selected-day summary.
replaceOrFail(
  "Matinee: <b>${esc(ch.matinee.name)}</b>",
  "Matinee: <b>${esc(cleanShowTitle(ch.matinee.name))}</b>",
  'matinee summary title'
);
replaceOrFail(
  "Evening: <b>${esc(ch.evening.name)}</b>",
  "Evening: <b>${esc(cleanShowTitle(ch.evening.name))}</b>",
  'evening summary title'
);

// Clean duplicate-warning title.
replaceOrFail(
  "You already selected <b>${esc(name)}</b> in another slot:",
  "You already selected <b>${esc(cleanShowTitle(name))}</b> in another slot:",
  'duplicate dialog title'
);

// The v2 calendar patch is applied before this file. Clean the name there and
// enrich theater/address through the price-insensitive showMeta lookup.
replaceOrFail(
  "<div class=\"calendar-choice\"><b>${icon} ${esc(c.name)}</b><div class=\"calendar-time\">${esc(c.time)}</div><div class=\"calendar-venue\">🎭 ${esc(venue)}</div>${address?`<div class=\"calendar-address\">📍 ${esc(address)}</div>`:''}</div>",
  "<div class=\"calendar-choice\"><b>${icon} ${esc(cleanShowTitle(c.name))}</b><div class=\"calendar-time\">${esc(c.time)}</div><div class=\"calendar-venue\">🎭 ${esc(venue)}</div>${address?`<div class=\"calendar-address\">📍 ${esc(address)}</div>`:''}</div>",
  'calendar clean title'
);

// Clean musical names in Excel/PDF exports too.
replaceOrFail(
  "musical:c.name,",
  "musical:cleanShowTitle(c.name),",
  'export musical title'
);

fs.writeFileSync(file,s);
console.log('Sanitized live, cached and saved musical titles; prices removed everywhere.');
