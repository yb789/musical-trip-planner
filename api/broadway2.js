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
    const text=$(a).text().replace(/\s+/g,' ').trim();
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
  const schedule={};
  const re=/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})(am|pm)\b/gi;
  let m;
  while((m=re.exec(text))){
    const mon=m[1][0].toUpperCase()+m[1].slice(1,3).toLowerCase();
    const date=`${m[3]}-${months[mon]}-${String(Number(m[2])).padStart(2,'0')}`;
    if(date<startS||date>endS) continue;
    let h=Number(m[4]);
    const ap=m[6].toLowerCase();
    if(ap==='pm'&&h!==12)h+=12;
    if(ap==='am'&&h===12)h=0;
    const time=`${String(h).padStart(2,'0')}:${m[5]}`;
    if(!schedule[date]) schedule[date]=[];
    if(!schedule[date].includes(time)) schedule[date].push(time);
  }

  let venue='Broadway, New York';
  const titleRe=regexEscape(title);
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

async function scrape(start,end){
  const musicalUrl='https://www.broadway.com/shows/tickets/?category=musical&view_all=true';
  const broadwayUrl='https://www.broadway.com/shows/tickets/?category=broadway&view_all=true';
  const [musicalHtml,broadwayHtml]=await Promise.all([fetchText(musicalUrl),fetchText(broadwayUrl)]);
  const candidates=intersection(extractShowLinks(musicalHtml,musicalUrl),extractShowLinks(broadwayHtml,broadwayUrl));
  if(!candidates.length) throw new Error('No Broadway musical candidates discovered');

  const dates=[];
  for(let d=new Date(start);d<=end;d=new Date(d.getTime()+86400000)) dates.push(iso(d));
  const schedule=Object.fromEntries(dates.map(d=>[d,[]]));
  const shows=[];

  const pages=await mapLimit(candidates,8,async show=>{
    const scheduleUrl=new URL('schedule/',show.href).href;
    const html=await fetchText(scheduleUrl);
    return {...show,scheduleUrl,...parseSchedule(html,show.name,start,end)};
  });

  for(const p of pages){
    if(!p||p.error) continue;
    let hasAny=false;
    for(const [date,times] of Object.entries(p.schedule||{})){
      if(!schedule[date]) continue;
      for(const time of times){
        schedule[date].push([p.name,time]);
        hasAny=true;
      }
    }
    if(hasAny){
      shows.push({
        name:p.name,
        venue:p.venue||'Broadway, New York',
        ticketUrl:p.href,
        infoUrl:p.href
      });
    }
  }

  for(const d of dates){
    const seen=new Set();
    schedule[d]=schedule[d].filter(([name,time])=>{
      const k=`${normalize(name)}|${time}`;
      if(seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  if(!shows.length) throw new Error('Broadway.com full schedule pages returned no performances for the selected range');
  return {shows,schedule,sources:['Broadway.com full show schedule pages']};
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
