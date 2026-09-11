import * as cheerio from "cheerio";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

function json(res,status,body){
  res.status(status);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
  res.end(JSON.stringify(body));
}

function parseISO(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s||"")) return null;
  const d=new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime())?null:d;
}
function iso(d){return d.toISOString().slice(0,10)}
function normalize(s){
  return String(s||"").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/&/g,"and")
    .replace(/\b(the|a|an|new|musical)\b/g," ")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}
function absolute(base,href){try{return new URL(href,base).href}catch{return ""}}
function time24(hhmm){
  if(!/^\d{4}$/.test(hhmm||"")) return null;
  const h=Number(hhmm.slice(0,2)),m=Number(hhmm.slice(2));
  if(h>23||m>59)return null;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
async function fetchText(url){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),10000);
  try{
    const r=await fetch(url,{
      headers:{
        "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9",
        "Cache-Control":"no-cache",
        "Pragma":"no-cache"
      },
      redirect:"follow",
      signal:c.signal
    });
    if(!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await r.text();
  }finally{clearTimeout(timer)}
}

function extractShowLinks(html,base){
  const $=cheerio.load(html), map=new Map();
  $('a[href*="/shows/"]').each((_,a)=>{
    let href=$(a).attr('href')||'';
    if(!href || href.includes('/shows/tickets/') || href.includes('/event/')) return;
    href=absolute(base,href).split('?')[0];
    if(!/^https:\/\/www\.broadway\.com\/shows\/[^/]+\/?$/.test(href)) return;
    const text=$(a).text().replace(/\s+/g,' ').trim();
    if(!text || text.length>120 || /learn more|buy tickets|reviews?/i.test(text)) return;
    const k=normalize(text);
    if(k.length<2) return;
    const prev=map.get(href);
    if(!prev || text.length>prev.name.length) map.set(href,{name:text,href});
  });
  return [...map.values()];
}

function matchIntersection(musicals,broadway){
  const broadwayByHref=new Map(broadway.map(x=>[x.href,x]));
  const broadwayByName=new Map(broadway.map(x=>[normalize(x.name),x]));
  const out=new Map();
  for(const m of musicals){
    let b=broadwayByHref.get(m.href) || broadwayByName.get(normalize(m.name));
    if(!b){
      const mk=normalize(m.name);
      b=broadway.find(x=>{
        const bk=normalize(x.name);
        return mk.length>5 && bk.length>5 && (mk.includes(bk)||bk.includes(mk));
      });
    }
    if(b) out.set(m.href,{name:m.name,href:m.href});
  }
  return [...out.values()];
}

function venueFromPage($){
  let venue='';
  $('a').each((_,a)=>{
    if(venue) return;
    const t=$(a).text().replace(/\s+/g,' ').trim();
    if(/\b(Theatre|Theater)\b/i.test(t) && t.length<100) venue=t;
  });
  if(venue) return venue;
  const text=$('body').text().replace(/\s+/g,' ');
  const m=text.match(/([A-Z][A-Za-z0-9'&.\- ]{2,70}(?:Theatre|Theater))/);
  return m?m[1].trim():'Broadway, New York';
}

function extractEvents(html,showUrl,start,end,title){
  const $=cheerio.load(html), schedule={};
  const startS=iso(start),endS=iso(end);
  $('a[href*="/event/"]').each((_,a)=>{
    const href=absolute(showUrl,$(a).attr('href')||'');
    const m=href.match(/\/event\/\d+\/(\d{2})-(\d{2})-(\d{4})\/(\d{4})\/?/);
    if(!m) return;
    const date=`${m[3]}-${m[1]}-${m[2]}`;
    if(date<startS||date>endS) return;
    const time=time24(m[4]);
    if(!time) return;
    if(!schedule[date]) schedule[date]=[];
    if(!schedule[date].includes(time)) schedule[date].push(time);
  });

  if(!Object.keys(schedule).length){
    const text=$('body').text().replace(/\s+/g,' ');
    const months={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
    const re=/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)\b/gi;
    let m;
    while((m=re.exec(text))){
      const mon=m[1][0].toUpperCase()+m[1].slice(1,3).toLowerCase();
      const date=`${m[3]}-${months[mon]}-${String(Number(m[2])).padStart(2,'0')}`;
      if(date<startS||date>endS) continue;
      let h=Number(m[4]); const min=m[5],ap=m[6].toLowerCase();
      if(ap==='pm'&&h!==12)h+=12;if(ap==='am'&&h===12)h=0;
      const time=`${String(h).padStart(2,'0')}:${min}`;
      if(!schedule[date]) schedule[date]=[];
      if(!schedule[date].includes(time)) schedule[date].push(time);
    }
  }
  return {title,venue:venueFromPage($),schedule};
}

async function mapLimit(items,limit,fn){
  const out=new Array(items.length); let next=0;
  async function worker(){
    while(true){
      const i=next++; if(i>=items.length) return;
      try{out[i]=await fn(items[i],i)}catch(e){out[i]={error:e,item:items[i]}}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}

async function scrapeBroadwayCom(start,end){
  const musicalUrl='https://www.broadway.com/shows/tickets/?category=musical&view_all=true';
  const broadwayUrl='https://www.broadway.com/shows/tickets/?category=broadway&view_all=true';
  const [musicalHtml,broadwayHtml]=await Promise.all([fetchText(musicalUrl),fetchText(broadwayUrl)]);
  const candidates=matchIntersection(extractShowLinks(musicalHtml,musicalUrl),extractShowLinks(broadwayHtml,broadwayUrl));
  if(!candidates.length) throw new Error('Broadway.com show discovery returned no Broadway musicals');

  const dates=[]; for(let d=new Date(start);d<=end;d=new Date(d.getTime()+86400000)) dates.push(iso(d));
  const schedule=Object.fromEntries(dates.map(d=>[d,[]]));
  const shows=[];

  const pages=await mapLimit(candidates,6,async show=>{
    const html=await fetchText(show.href);
    return {...show,...extractEvents(html,show.href,start,end,show.name)};
  });

  for(const p of pages){
    if(!p || p.error) continue;
    let hasAny=false;
    for(const [date,times] of Object.entries(p.schedule)){
      if(!schedule[date]) continue;
      for(const time of times){
        schedule[date].push([p.name,time]);
        hasAny=true;
      }
    }
    if(hasAny){
      shows.push({name:p.name,venue:p.venue||'Broadway, New York',ticketUrl:p.href,infoUrl:p.href});
    }
  }

  for(const d of dates){
    const seen=new Set();
    schedule[d]=schedule[d].filter(([n,t])=>{const k=`${normalize(n)}|${t}`;if(seen.has(k))return false;seen.add(k);return true});
  }
  if(!shows.length) throw new Error('Broadway.com returned no performances in the selected date range');
  return {shows,schedule,sources:['Broadway.com (Broadway musical listings and dated performance schedules)']};
}

export default async function handler(req,res){
  if(req.method!=='GET') return json(res,405,{error:'GET only'});
  const start=parseISO(String(req.query.start||'')),end=parseISO(String(req.query.end||''));
  if(!start||!end||start>end) return json(res,400,{error:'Invalid start/end dates'});
  const dayCount=Math.floor((end-start)/86400000)+1;
  if(dayCount>21) return json(res,400,{error:'Please select a date range of 21 days or fewer.'});
  const key=`${iso(start)}|${iso(end)}`,cached=cache.get(key);
  if(cached&&Date.now()-cached.at<CACHE_TTL_MS) return json(res,200,cached.data);
  try{
    const result=await scrapeBroadwayCom(start,end);
    const data={city:'broadway',start:iso(start),end:iso(end),refreshedAt:new Date().toISOString(),...result};
    cache.set(key,{at:Date.now(),data});
    return json(res,200,data);
  }catch(err){
    console.error('Broadway fallback failed:',err);
    return json(res,502,{error:'The Broadway schedule source could not be read right now.',detail:String(err?.message||err)});
  }
}
