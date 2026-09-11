import fs from 'node:fs';

const file='index.html';
let s=fs.readFileSync(file,'utf8');

// Add one small title-cleaning helper. This deliberately never aborts the build
// merely because a display fragment changed.
const oldShowMeta="function showMeta(name){return current().shows.find(s=>s.name===name)||{name,venue:cityLabel()}}";
const newShowMeta=`function cleanShowTitle(name){
  let x=String(name||'').replace(/\\s+/g,' ').trim();
  const priceAt=x.search(/\\s+from\\s+(?:US)?\\$[\\d,.]+/i);
  if(priceAt>0)x=x.slice(0,priceAt);
  const saveAt=x.search(/\\s+save(?:\\s+up\\s+to)?\\s+(?:US)?\\$[\\d,.]+/i);
  if(saveAt>0)x=x.slice(0,saveAt);
  return x.trim();
}
function showMeta(name){
  const wanted=cleanShowTitle(name).toLowerCase();
  return current().shows.find(s=>cleanShowTitle(s.name).toLowerCase()===wanted)||{name:cleanShowTitle(name),venue:cityLabel()};
}
// Clean selections saved by older versions of the site.
for(const cityKey of ['london','broadway']){
  for(const day of Object.values(state.choices[cityKey]||{})){
    for(const session of ['matinee','evening']){
      if(day?.[session]?.name) day[session].name=cleanShowTitle(day[session].name);
    }
  }
}`;
if(s.includes(oldShowMeta)) s=s.replace(oldShowMeta,newShowMeta);

// Display clean titles everywhere that a saved or live choice can appear.
s=s.replaceAll('esc(ch.matinee.name)','esc(cleanShowTitle(ch.matinee.name))');
s=s.replaceAll('esc(ch.evening.name)','esc(cleanShowTitle(ch.evening.name))');
s=s.replaceAll('esc(c.name)','esc(cleanShowTitle(c.name))');
s=s.replaceAll('musical:c.name','musical:cleanShowTitle(c.name)');

// These two are mainly defensive; the API now sends clean Broadway titles too.
s=s.replaceAll('<b>${esc(s.name)}</b>','<b>${esc(cleanShowTitle(s.name))}</b>');
s=s.replaceAll('<div class="show-title">${esc(name)}</div>','<div class="show-title">${esc(cleanShowTitle(name))}</div>');

fs.writeFileSync(file,s);
console.log('Price-free musical titles applied.');
