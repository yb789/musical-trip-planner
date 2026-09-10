import * as cheerio from "cheerio";

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();
const broadwayMetaCache = new Map();

function json(res, status, body){
  res.status(status);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
  res.end(JSON.stringify(body));
}

function parseISO(s){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
function iso(d){ return d.toISOString().slice(0,10); }
function addDays(d,n){ const x=new Date(d); x.setUTCDate(x.getUTCDate()+n); return x; }
function rangeDates(start,end){
  const out=[]; let d=new Date(start);
  while(d<=end && out.length<32){ out.push(iso(d)); d=addDays(d,1); }
  return out;
}
function normalizeTitle(s){
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/&/g,"and")
    .replace(/^the\s+/,"")
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}
function absolute(base, href){
  if(!href) return "";
  try{return new URL(href,base).href}catch{return ""}
}
function normalizeTime(raw){
  const m=String(raw||"").trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
  if(!m) return null;
  let h=Number(m[1]), min=m[2], ap=m[3].toLowerCase();
  if(ap==="pm" && h!==12) h+=12;
  if(ap==="am" && h===12) h=0;
  return `${String(h).padStart(2,"0")}:${min}`;
}
function extractTimes(text){
  const matches = String(text||"").match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi) || [];
  return [...new Set(matches.map(normalizeTime).filter(Boolean))];
}
async function fetchText(url){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(url,{
      headers:{
        "User-Agent":"Mozilla/5.0 (compatible; MusicalTripPlanner/1.0; +https://example.com)",
        "Accept":"text/html,application/xhtml+xml"
      },
      signal:controller.signal
    });
    if(!r.ok) throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await r.text();
  }finally{
    clearTimeout(timer);
  }
}

function bestContainer($, el){
  let node=$(el);
  for(let i=0;i<8 && node.length;i++){
    const t=node.text();
    if(/Performances/i.test(t) && /Playing at:/i.test(t)) return node;
    node=node.parent();
  }
  return $(el).parent();
}

async function scrapeLondonDay(date){
  const [y,m,d]=date.split("-");
  const musicalUrl=`https://www.londontheatre.co.uk/whats-on/musicals?date=${date}`;
  const timesUrl=`https://www.londonboxoffice.co.uk/search/london-shows/${y}/${m}/${d}/2`;

  const [musicalHtml,timesHtml]=await Promise.all([
    fetchText(musicalUrl),
    fetchText(timesUrl)
  ]);

  // LondonTheatre date page is used as the musical-category authority.
  const $m=cheerio.load(musicalHtml);
  const musicalNames=new Map();

  // Prefer show-like links in the main content. We collect both title and nearby venue.
  $m("main a, article a, [role='main'] a").each((_,a)=>{
    const text=$m(a).text().replace(/\s+/g," ").trim();
    const href=$m(a).attr("href") || "";
    if(!text || text.length>100) return;
    if(/news|review|ticket|today|weekend|musical|west end|theatre week|all shows/i.test(text)) return;
    if(/\/(show|shows|tickets|theatre)\b/i.test(href) || href.startsWith("/")){
      const n=normalizeTitle(text);
      if(n.length>=3) musicalNames.set(n,{name:text,href:absolute(musicalUrl,href)});
    }
  });

  const $=cheerio.load(timesHtml);
  const performances=[];
  const foundShows=new Map();

  $("h2,h3,h4").each((_,h)=>{
    const title=$(h).text().replace(/\s+/g," ").trim();
    if(!title || title.length>120) return;

    const container=bestContainer($,h);
    const block=container.text().replace(/\s+/g," ").trim();
    if(!/Performances/i.test(block)) return;

    const norm=normalizeTitle(title);
    let musical=musicalNames.get(norm);

    // Fuzzy fallback for minor title differences.
    if(!musical){
      for(const [k,v] of musicalNames){
        if(k===norm || (k.length>5 && norm.length>5 && (k.includes(norm)||norm.includes(k)))){
          musical=v; break;
        }
      }
    }
    if(!musical) return;

    const times=extractTimes(block);
    if(!times.length) return;

    let venue="";
    const vm=block.match(/Playing at:\s*(.*?)(?:Booking until:|Starring:|Performances|Tickets from|$)/i);
    if(vm) venue=vm[1].trim();

    // Date-specific ticket link from the listing if available.
    let ticketUrl="";
    container.find("a").each((_,a)=>{
      if(ticketUrl) return;
      const at=$(a).text().trim();
      const href=$(a).attr("href");
      if(href && /\bBook\b/i.test(at)) ticketUrl=absolute(timesUrl,href);
    });

    const show={
      name: musical.name || title,
      venue: venue || "London",
      ticketUrl: ticketUrl || timesUrl,
      infoUrl: musical.href || musicalUrl
    };
    foundShows.set(normalizeTitle(show.name),show);
    times.forEach(time=>performances.push([show.name,time]));
  });

  // Some listings use non-heading title elements; fall back to musical candidates + page text.
  if(!performances.length){
    for(const [,musical] of musicalNames){
      const name=musical.name;
      const idx=timesHtml.toLowerCase().indexOf(name.toLowerCase());
      if(idx<0) continue;
      const chunk=cheerio.load(timesHtml.slice(Math.max(0,idx-1000),idx+5000)).text();
      const times=extractTimes(chunk);
      if(!times.length) continue;
      const show={name,venue:"London",ticketUrl:timesUrl,infoUrl:musical.href||musicalUrl};
      foundShows.set(normalizeTitle(name),show);
      times.forEach(time=>performances.push([name,time]));
    }
  }

  return {date,performances,shows:[...foundShows.values()]};
}

function inferDateFromHeader(mm,dd,anchorDate){
  const a=new Date(`${anchorDate}T12:00:00Z`);
  const candidates=[a.getUTCFullYear()-1,a.getUTCFullYear(),a.getUTCFullYear()+1]
    .map(y=>new Date(Date.UTC(y,Number(mm)-1,Number(dd),12)));
  candidates.sort((x,y)=>Math.abs(x-a)-Math.abs(y-a));
  return iso(candidates[0]);
}

async function broadwayShowMeta(title, href){
  const key=href || title;
  if(broadwayMetaCache.has(key)) return broadwayMetaCache.get(key);

  const fallback={
    musical:/musical|wicked|hamilton|hadestown|aladdin|chicago|lion king|mj|outsiders|juliet|gatsby|schmigadoon|six|buena vista|just in time|rocky horror|mamma mia|fantasticks|evita/i.test(title),
    venue:"Broadway, New York",
    ticketUrl:"https://www.broadway.org/shows",
    infoUrl:href || "https://www.broadway.org/shows"
  };

  if(!href){
    broadwayMetaCache.set(key,fallback);
    return fallback;
  }

  try{
    const page=await fetchText(href);
    const $=cheerio.load(page);
    const musical=$("h1,h2,h3,h4,h5,h6").toArray().some(el=>$(el).text().trim().toLowerCase()==="musical");

    let venue="";
    const theatreLink=$('a[href*="/broadway-theatres/"]').filter((_,a)=>$(a).text().trim().length>2).first();
    if(theatreLink.length) venue=theatreLink.text().replace(/\s+/g," ").trim();

    let ticketUrl="";
    $("a").each((_,a)=>{
      if(ticketUrl) return;
      const t=$(a).text().replace(/\s+/g," ").trim();
      const h=$(a).attr("href");
      if(h && /Buy from Official Source/i.test(t)) ticketUrl=absolute(href,h);
    });

    const meta={
      musical,
      venue:venue || fallback.venue,
      ticketUrl:ticketUrl || fallback.ticketUrl,
      infoUrl:href
    };
    broadwayMetaCache.set(key,meta);
    return meta;
  }catch{
    broadwayMetaCache.set(key,fallback);
    return fallback;
  }
}

async function scrapeBroadwayWeek(startDate){
  const url=`https://www.broadway.org/performance-times?start=${startDate}`;
  const page=await fetchText(url);
  const $=cheerio.load(page);

  let table=$("table").filter((_,t)=>/Run Time|Show Time/i.test($(t).text())).first();
  if(!table.length) table=$("table").first();
  if(!table.length) throw new Error("Broadway performance table not found");

  const headerRow=table.find("tr").first();
  const headers=headerRow.find("th,td").toArray().map(el=>$(el).text().replace(/\s+/g," ").trim());
  const dateColumns=[];

  headers.forEach((h,i)=>{
    const m=h.match(/(\d{1,2})\/(\d{1,2})/);
    if(m) dateColumns.push({index:i,date:inferDateFromHeader(m[1],m[2],startDate)});
  });

  const rawRows=[];
  table.find("tr").slice(1).each((_,tr)=>{
    const cells=$(tr).find("th,td");
    if(cells.length<2) return;

    const first=cells.eq(0);
    const title=first.text().replace(/\s+/g," ").trim();
    if(!title) return;

    let href=first.find("a").attr("href") || "";
    href=absolute(url,href);

    const dateTimes={};
    if(dateColumns.length){
      dateColumns.forEach(dc=>{
        const times=extractTimes(cells.eq(dc.index).text());
        if(times.length) dateTimes[dc.date]=times;
      });
    }else{
      // Fallback for responsive versions of the table.
      const start=new Date(`${startDate}T12:00:00Z`);
      const probable=cells.slice(2).toArray();
      probable.slice(0,7).forEach((cell,idx)=>{
        const times=extractTimes($(cell).text());
        if(times.length) dateTimes[iso(addDays(start,idx))]=times;
      });
    }

    if(Object.keys(dateTimes).length) rawRows.push({title,href,dateTimes});
  });

  const metaList=await Promise.all(rawRows.map(r=>broadwayShowMeta(r.title,r.href)));

  const rows=[];
  rawRows.forEach((r,i)=>{
    const meta=metaList[i];
    if(!meta.musical) return;
    rows.push({...r,...meta});
  });

  return {url,rows};
}

async function scrapeBroadwayRange(start,end){
  const dates=rangeDates(start,end);
  const schedule=Object.fromEntries(dates.map(d=>[d,[]]));
  const shows=new Map();
  const sourceUrls=[];

  // Query in 7-day chunks. Broadway.org supports a start=YYYY-MM-DD schedule grid.
  for(let i=0;i<dates.length;i+=7){
    const week=await scrapeBroadwayWeek(dates[i]);
    sourceUrls.push(week.url);

    for(const row of week.rows){
      shows.set(normalizeTitle(row.title),{
        name:row.title,
        venue:row.venue,
        ticketUrl:row.ticketUrl,
        infoUrl:row.infoUrl
      });
      for(const [date,times] of Object.entries(row.dateTimes)){
        if(!schedule[date]) continue;
        times.forEach(time=>schedule[date].push([row.title,time]));
      }
    }
  }

  for(const date of dates){
    const seen=new Set();
    schedule[date]=schedule[date].filter(([n,t])=>{
      const k=`${normalizeTitle(n)}|${t}`;
      if(seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  return {shows:[...shows.values()],schedule,sourceUrls};
}

async function scrapeLondonRange(start,end){
  const dates=rangeDates(start,end);
  const schedule=Object.fromEntries(dates.map(d=>[d,[]]));
  const shows=new Map();

  // Use limited concurrency to avoid hitting source sites too aggressively.
  const results=[];
  for(let i=0;i<dates.length;i+=4){
    const batch=await Promise.all(dates.slice(i,i+4).map(scrapeLondonDay));
    results.push(...batch);
  }

  for(const r of results){
    schedule[r.date]=r.performances;
    r.shows.forEach(show=>shows.set(normalizeTitle(show.name),show));
  }

  return {shows:[...shows.values()],schedule};
}

export default async function handler(req,res){
  if(req.method!=="GET") return json(res,405,{error:"GET only"});

  const city=String(req.query.city||"").toLowerCase();
  const start=parseISO(String(req.query.start||""));
  const end=parseISO(String(req.query.end||""));

  if(!["london","broadway"].includes(city)) return json(res,400,{error:"city must be london or broadway"});
  if(!start || !end || start>end) return json(res,400,{error:"Invalid start/end dates"});

  const dayCount=Math.floor((end-start)/86400000)+1;
  if(dayCount>21) return json(res,400,{error:"Please select a date range of 21 days or fewer for live searching."});

  const key=`${city}|${iso(start)}|${iso(end)}`;
  const cached=cache.get(key);
  if(cached && Date.now()-cached.at<CACHE_TTL_MS) return json(res,200,cached.data);

  try{
    let result;
    if(city==="london"){
      result=await scrapeLondonRange(start,end);
    }else{
      result=await scrapeBroadwayRange(start,end);
    }

    const data={
      city,
      start:iso(start),
      end:iso(end),
      refreshedAt:new Date().toISOString(),
      shows:result.shows,
      schedule:result.schedule,
      sources: city==="london"
        ? ["LondonTheatre.co.uk (musical listings)","London Box Office (performance times)"]
        : ["Broadway.org / The Broadway League (performance times and show classification)"],
      sourceUrls:result.sourceUrls || []
    };

    cache.set(key,{at:Date.now(),data});
    return json(res,200,data);
  }catch(err){
    console.error(err);
    return json(res,502,{
      error:"The live theatre sources could not be read right now. Their page structure may have changed or a source may be temporarily unavailable.",
      detail:String(err?.message||err)
    });
  }
}
