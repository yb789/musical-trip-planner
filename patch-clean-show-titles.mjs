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

// Add a display-name cleaner and make metadata lookup ignore price suffixes.
replaceOrFail(
  "function days(){const out=[];let d=state.start,g=0;while(d<=state.end&&g++<31){out.push(d);d=addDays(d,1)}return out}function cityLabel(){return state.city==='london'?'London · West End':'New York · Broadway'}function cityShort(){return state.city==='london'?'London musicals':'Broadway musicals'}function current(){return state.data[state.city]}function choices(){return state.choices[state.city]}function showMeta(name){return current().shows.find(s=>s.name===name)||{name,venue:cityLabel()}}",
  `function days(){const out=[];let d=state.start,g=0;while(d<=state.end&&g++<31){out.push(d);d=addDays(d,1)}return out}function cityLabel(){return state.city==='london'?'London · West End':'New York · Broadway'}function cityShort(){return state.city==='london'?'London musicals':'Broadway musicals'}function current(){return state.data[state.city]}function choices(){return state.choices[state.city]}
function cleanShowTitle(name){
  let x=String(name||'').replace(/\\s+/g,' ').trim();
  x=x.replace(/\\s+from\\s+\\$[\\d,.]+(?:\\s+(?:save)(?:\\s+up\\s+to)?\\s+\\$[\\d,.]+)?\\s*$/i,'');
  x=x.replace(/\\s+save(?:\\s+up\\s+to)?\\s+\\$[\\d,.]+\\s*$/i,'');
  x=x.replace(/\\s+from\\s+\\$[\\d,.]+\\s*$/i,'');
  return x.trim();
}
function showMeta(name){
  const wanted=cleanShowTitle(name).toLowerCase();
  return current().shows.find(s=>cleanShowTitle(s.name).toLowerCase()===wanted)||{name:cleanShowTitle(name),venue:cityLabel()};
}`,
  'cleanShowTitle/showMeta'
);

// Clean names in the left-hand musical list while keeping raw names internally.
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

// Clean musical names in Excel/PDF exports too. Price remains absent from all
// calendar/export fields.
replaceOrFail(
  "musical:c.name,",
  "musical:cleanShowTitle(c.name),",
  'export musical title'
);

fs.writeFileSync(file,s);
console.log('Removed ticket-price suffixes from musical names throughout the planner.');
