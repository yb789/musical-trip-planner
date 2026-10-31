import * as cheerio from "cheerio";
import { applySeatPlanLinks } from "../lib/seatplan.js";
import { guideEntryFor, guide, kindOf, isPastBooking, showPerformances } from "../lib/site-pages.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function json(res,status,body){
  res.status(status);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  // Errors must never be cached by the CDN: one bad fetch from broadway.com used to blank the
  // planner for everyone choosing the same dates for up to 15 minutes (30 Oct 2026).
  res.setHeader("Cache-Control",status>=400?"no-store":"s-maxage=300, stale-while-revalidate=600");
  res.end(JSON.stringify(body));
}

function parseISO(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s||"")) return null;
  const d=new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime())?null:d;
}
function iso(d){return d.toISOString().slice(0,10)}
function cleanShowTitle(s){
  let x=String(s||"").replace(/\s+/g," ").trim();
  // Broadway.com sometimes appends offer text to a title, e.g.
  // "Maybe Happy Ending from $61.03 Save $84.00".
  // Strip that pricing/discount metadata before the app receives the title.
  x=x.replace(/\s+from\s+\$[\d,.]+.*$/i,"");
  x=x.replace(/\s+save(?:\s+up\s+to)?\s+\$[\d,.]+.*$/i,"");
  return x.trim();
}
function normalize(s){
  return cleanShowTitle(s).toLowerCase().normalize("NFKD")
    .replace(/\p{M}/gu,"")
    .replace(/&/g,"and")
    .replace(/\b(the|a|an|new|musical)\b/g," ")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}
// "$110.08" -> "$110.08", "$97.00" -> "$97"; anything else -> "".
function formatPrice(raw){const m=String(raw||"").match(/([£$])\s*(\d[\d,]*)(?:\.(\d{2}))?/);if(!m)return"";const whole=m[2].replace(/,/g,"");return m[1]+whole+(m[3]&&m[3]!=="00"?"."+m[3]:"")}
function absolute(base,href){try{return new URL(href,base).href}catch{return ""}}
function regexEscape(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}

async function fetchText(url){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),12000);
  try{
    const r=await fetch(url,{
      headers:{
        "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9"
      },
      redirect:"follow",
      signal:c.signal
    });
    if(!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractShowLinks(html,base){
  const $=cheerio.load(html), byHref=new Map();
  $('a[href*="/shows/"]').each((_,a)=>{
    let href=$(a).attr('href')||'';
    if(!href || href.includes('/shows/tickets/') || href.includes('/event/') || href.includes('/schedule/')) return;
    href=absolute(base,href).split('?')[0];
    if(!/^https:\/\/www\.broadway\.com\/shows\/[^/]+\/?$/.test(href)) return;
    const rawText=$(a).text().replace(/\s+/g,' ').trim();
    const text=cleanShowTitle(rawText);
    if(!text || text.length>120 || /learn more|buy tickets|reviews?|schedule|theater/i.test(text)) return;
    const prev=byHref.get(href);
    if(!prev || text.length>prev.name.length) byHref.set(href,{name:text,href});
  });
  return [...byHref.values()];
}

function intersection(musicals,broadway){
  const broadwayHref=new Set(broadway.map(x=>x.href));
  const broadwayNames=new Set(broadway.map(x=>normalize(x.name)));
  return musicals.filter(m=>broadwayHref.has(m.href)||broadwayNames.has(normalize(m.name)));
}

function parseSchedule(html,title,start,end){
  const $=cheerio.load(html);
  const text=$('body').text().replace(/\s+/g,' ');
  const startS=iso(start), endS=iso(end);
  const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const schedule={}; // date -> [{time, meta}] ; meta = {from:"$110", soldOut:true}
  const toTime=(hh,mm,ap)=>{let h=Number(hh);ap=ap.toLowerCase();if(ap==='pm'&&h!==12)h+=12;if(ap==='am'&&h===12)h=0;return `${String(h).padStart(2,'0')}:${mm}`};
  const toDate=(mon,day,year)=>`${year}-${months[mon[0].toUpperCase()+mon.slice(1,3).toLowerCase()]}-${String(Number(day)).padStart(2,'0')}`;
  const add=(date,time,meta)=>{if(date<startS||date>endS)return;if(!schedule[date])schedule[date]=[];if(!schedule[date].some(x=>x.time===time))schedule[date].push({time,meta})};
  // Broadway.com's schedule rows carry a per-performance "from $X" (or "Sold Out").
  $('.showpage__event-info--right-container').each((_,row)=>{
    const dm=$(row).find('.showpage__event-info--date').text().match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})/i);
    const tm=$(row).find('.showpage__event-info--time').text().match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if(!dm||!tm) return;
    const meta={};
    const from=formatPrice($(row).find('.showpage__event-info--price').text());
    if(from) meta.from=from;
    if(/sold out/i.test($(row).find('.showpage__event-unavailable-text').text())) meta.soldOut=true;
    add(toDate(dm[1],dm[2],dm[3]),toTime(tm[1],tm[2],tm[3]),meta);
  });
  if(!Object.keys(schedule).length){
    const re=/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)\b/gi;
    let m;
    while((m=re.exec(text))) add(toDate(m[1],m[2],m[3]),toTime(m[4],m[5],m[6]),{});
  }

  let venue='Broadway, New York';
  const cleanTitle=cleanShowTitle(title);
  const titleRe=regexEscape(cleanTitle);
  const vm=text.match(new RegExp(`${titleRe}\\s+([A-Z][A-Za-z0-9'&.\\- ]{2,80}(?:Theatre|Theater))\\s+New York, NY`,'i'));
  if(vm) venue=vm[1].trim();
  if(venue==='Broadway, New York'){
    $('a').each((_,a)=>{
      if(venue!=='Broadway, New York') return;
      const t=$(a).text().replace(/\s+/g,' ').trim();
      if(/\b(Theatre|Theater)\b/i.test(t)&&t.length<100) venue=t;
    });
  }
  return {schedule,venue};
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length);
  let next=0;
  async function worker(){
    while(true){
      const i=next++;
      if(i>=items.length) return;
      try{out[i]=await fn(items[i],i)}catch(error){out[i]={error,item:items[i]}}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}

// Last list of shows that was discovered successfully (per function instance). broadway.com sometimes
// answers the listing pages with an empty or bot-check page; the show list barely changes from hour to
// hour, so the previous good list is used instead of failing the whole search.
let lastCandidates=null; // {at, list}
const LAST_GOOD_MS=24*60*60*1000;

async function discoverCandidates(){
  const musicalUrl='https://www.broadway.com/shows/tickets/?category=musical&view_all=true';
  const broadwayUrl='https://www.broadway.com/shows/tickets/?category=broadway&view_all=true';
  const playUrl='https://www.broadway.com/shows/tickets/?category=play&view_all=true';
  const [musicalHtml,broadwayHtml,playHtml]=await Promise.all([fetchText(musicalUrl),fetchText(broadwayUrl),fetchText(playUrl).catch(()=>'')]);
  // Plays (and other non-musicals) are kept only when our guide lists them, so the planner can
  // offer them to visitors who opt in; everything else on the plays list is ignored.
  const musicalLinks=extractShowLinks(musicalHtml,musicalUrl);
  const musicalHrefs=new Set(musicalLinks.map(m=>m.href));
  const playLinks=playHtml?extractShowLinks(playHtml,playUrl).filter(p=>!musicalHrefs.has(p.href)&&(guideEntryFor('new-york',p.name)||{}).kind&&guideEntryFor('new-york',p.name).kind!=='musical'):[];
  return intersection([...musicalLinks,...playLinks],extractShowLinks(broadwayHtml,broadwayUrl));
}

async function candidatesWithRetry(){
  let lastErr=null;
  for(let attempt=0;attempt<2;attempt++){
    if(attempt) await new Promise(r=>setTimeout(r,1500));
    try{
      const list=await discoverCandidates();
      if(list.length){lastCandidates={at:Date.now(),list};return list}
      lastErr=new Error('No Broadway musical candidates discovered');
    }catch(err){lastErr=err}
  }
  if(lastCandidates&&Date.now()-lastCandidates.at<LAST_GOOD_MS){
    console.warn('Broadway show list unavailable, using the last good list:',String(lastErr?.message||lastErr));
    return lastCandidates.list;
  }
  throw lastErr||new Error('No Broadway musical candidates discovered');
}

// Guide shows that broadway.com doesn't list — the Rockettes' Christmas Spectacular at Radio City Music
// Hall (31 Oct 2026) — take their times from the licensed Ticketmaster Discovery API. Opt-in per guide
// entry with `tmSchedule: true`. Never fails the Broadway schedule.
async function ticketmasterGuideShows(start,end,haveNames,schedule){
  const have=new Set(haveNames.map(n=>(guideEntryFor('new-york',n)||{}).id).filter(Boolean));
  const startS=iso(start), endS=iso(end), out=[];
  for(const g of guide('new-york').filter(g=>g.tmSchedule&&!have.has(g.id)&&!isPastBooking(g))){
    // A day either side: Ticketmaster's window is UTC, localDate is what counts.
    const days=Math.round((end-start)/86400000)+3;
    const r=await showPerformances('new-york',g,{start:iso(new Date(start.getTime()-86400000)),days}).catch(()=>({ok:false}));
    if(!r.ok) continue;
    let any=false, venue='';
    const seen=new Set();
    for(const p of r.performances){
      if(p.date<startS||p.date>endS||!schedule[p.date]||!/^\d{2}:\d{2}$/.test(p.time)||/cancel|postpone/i.test(p.status)) continue;
      if(seen.has(p.date+'|'+p.time)) continue;
      seen.add(p.date+'|'+p.time);
      schedule[p.date].push(p.from?[g.title,p.time,{from:p.from}]:[g.title,p.time]);
      any=true; venue=venue||p.venue;
    }
    if(any) out.push({name:g.title,venue:g.venue||venue,ticketUrl:g.tickets||'',infoUrl:g.tickets||'',kind:kindOf(g)});
  }
  return out;
}

async function scrape(start,end){
  const candidates=await candidatesWithRetry();

  const dates=[];
  for(let d=new Date(start);d<=end;d=new Date(d.getTime()+86400000)) dates.push(iso(d));
  const schedule=Object.fromEntries(dates.map(d=>[d,[]]));
  const shows=[];

  const pages=await mapLimit(candidates,8,async show=>{
    const scheduleUrl=new URL('schedule/',show.href).href;
    const html=await fetchText(scheduleUrl);
    const cleanName=cleanShowTitle(show.name);
    return {...show,name:cleanName,scheduleUrl,...parseSchedule(html,cleanName,start,end)};
  });

  for(const p of pages){
    if(!p||p.error) continue;
    const cleanName=cleanShowTitle(p.name);
    let hasAny=false;
    for(const [date,times] of Object.entries(p.schedule||{})){
      if(!schedule[date]) continue;
      for(const {time,meta} of times){
        schedule[date].push(meta&&Object.keys(meta).length?[cleanName,time,meta]:[cleanName,time]);
        hasAny=true;
      }
    }
    if(hasAny){
      shows.push({
        name:cleanName,
        venue:p.venue||'Broadway, New York',
        ticketUrl:p.href,
        infoUrl:p.href,
        kind:(guideEntryFor('new-york',cleanName)||{}).kind||'musical'
      });
    }
  }

  const tmShows=await ticketmasterGuideShows(start,end,shows.map(s=>s.name),schedule).catch(err=>{console.error('Ticketmaster guide shows failed:',err?.message||err);return []});
  shows.push(...tmShows);

  for(const d of dates){
    const seen=new Set();
    schedule[d]=schedule[d].map(([name,time,meta])=>meta?[cleanShowTitle(name),time,meta]:[cleanShowTitle(name),time]).filter(([name,time])=>{
      const k=`${normalize(name)}|${time}`;
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  if(!shows.length) throw new Error('Broadway.com full schedule pages returned no performances for the selected range');
  // Ticket links point at SeatPlan; the Broadway.com show page stays available as infoUrl / sourceTicketUrl.
  await applySeatPlanLinks('broadway',shows);
  const sources=['Broadway.com full show schedule pages (times and starting prices)','SeatPlan (ticket links)'];
  if(tmShows.length) sources.push('Ticketmaster ('+tmShows.map(s=>s.name).join(', ')+')');
  return {shows,schedule,sources};
}

export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'GET only'});
  const start=parseISO(String(req.query.start||''));
  const end=parseISO(String(req.query.end||''));
  if(!start||!end||start>end) return json(res,400,{error:'Invalid start/end dates'});
  const dayCount=Math.floor((end-start)/86400000)+1;
  if(dayCount>21) return json(res,400,{error:'Please select a date range of 21 days or fewer.'});

  const key=`${iso(start)}|${iso(end)}`;
  const cached=cache.get(key);
  if(cached&&Date.now()-cached.at<CACHE_TTL_MS) return json(res,200,cached.data);

  try{
    const result=await scrape(start,end);
    const data={city:'broadway',start:iso(start),end:iso(end),refreshedAt:new Date().toISOString(),...result};
    cache.set(key,{at:Date.now(),data});
    return json(res,200,data);
  }catch(err){
    console.error('Broadway schedule failed:',err);
    return json(res,502,{error:'The Broadway schedule source could not be read right now.',detail:String(err?.message||err)});
  }
}
