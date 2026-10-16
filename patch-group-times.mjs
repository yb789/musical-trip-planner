import fs from 'node:fs';

// One card per show per session, even when the listing reports several start times
// (immersive shows like Masquerade admit groups every 15 minutes and list each wave as a
// performance). The card shows every time, with one Choose button per time.
// Also shows the guide's venue when the listing only says "Broadway, New York", and an
// Off-Broadway pill for shows the guide marks as such.
// Runs last: it replaces the whole cards() function that earlier patches shaped.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const start = s.indexOf('function cards(items){');
const endMarker = "}).join('')}";
const end = start >= 0 ? s.indexOf(endMarker, start) : -1;
if (start < 0 || end < 0) { console.error('patch-group-times: cards() not found'); process.exit(1); }
const cards = `function cards(items){if(!items.length)return'<div class="empty">No matching performances.</div>';const ch=choices()[state.active]||{};const groups=new Map();for(const [name,time] of items){if(!groups.has(name))groups.set(name,[]);groups.get(name).push(time)}return [...groups].map(([name,times])=>{const session=mins(times[0])<1020?'matinee':'evening',sel=ch[session]&&ch[session].name===name?ch[session].time:null,m=showMeta(name),g=typeof window.mhGuideEntry==='function'?window.mhGuideEntry(name):null,venue=(m.venue&&!/^(broadway, new york|new york|london)$/i.test(m.venue)?m.venue:(g&&g.venue)||m.venue||'').replace(/[ ]*·[ ]*Off-Broadway$/,''),offB=!!(g&&g.offBroadway),multi=times.length>1,on=sel!==null&&times.includes(sel);const btn=t=>{const o=sel===t;return \`<button class="pick \${o?'selected':''}" data-name="\${esc(name)}" data-time="\${esc(t)}" title="\${o?'Remove this performance from your plan':'Choose the '+t+' performance'}">\${o?'Deselect ✕':(multi?esc(t):'Choose')}</button>\`};return \`<article class="show-card\${multi?' multi':''}"><div class="time\${multi?' multi':''}">\${multi?times.map(esc).join('<br>'):esc(times[0])}</div><div><div class="show-title" data-show="\${esc(name)}">\${esc(cleanShowTitle(name))}</div><div class="show-venue">\${esc(venue)}\${offB?' <span class="pill off-bway">Off-Broadway</span>':''}</div>\${multi?\`<div class="show-venue">\${times.length} start times on this date — pick one</div>\`:''}\${on?\`<div class="card-links">\${linkHtml(ch[session])}</div>\`:''}</div><div class="pick-group">\${times.map(btn).join('')}</div></article>\`}).join('')}`;
s = s.slice(0, start) + cards + s.slice(end + endMarker.length);
const css = '.pill.off-bway{display:inline-block;margin-left:4px;padding:1px 7px;border-radius:999px;background:#e8eef7;color:#24406b;font-size:11px;font-weight:600;vertical-align:middle}.pick-group{display:flex;flex-direction:column;gap:6px;align-items:stretch}.time.multi{font-size:14px;line-height:1.55;padding:6px 4px}@media(max-width:560px){.pick-group{grid-column:2;flex-direction:row;flex-wrap:wrap}}';
if (!s.includes('.pick-group{')) s = s.replace('</style>', css + '</style>');
fs.writeFileSync(file, s);
console.log('patch-group-times: cards() groups several start times of one show.');
