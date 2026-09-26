import * as cheerio from "cheerio";
import broadwayHandler from "./broadway2.js";
import { applySeatPlanLinks, enrichMissingShowInfo } from "./seatplan.js";
import { findMissingPerformances } from "../lib/lbo-calendar.js";

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
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
function rangeDates(start,end){const out=[];let d=new Date(start);while(d<=end&&out.length<32){out.push(iso(d));d=addDays(d,1)}return out}
function normalizeTitle(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/\p{M}/gu,"").replace(/&/g,"and").replace(/^the\s+/,"").replace(/[^a-z0-9]+/g,"").trim()}
function absolute(base,href){if(!href)return"";try{return new URL(href,base).href}catch{return""}}
function normalizeTime(raw){const m=String(raw||"").trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);if(!m)return null;let h=Number(m[1]),min=m[2],ap=m[3].toLowerCase();if(ap==="pm"&&h!==12)h+=12;if(ap==="am"&&h===12)h=0;return `${String(h).padStart(2,"0")}:${min}`}
function extractTimes(text){const matches=String(text||"").match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi)||[];return [...new Set(matches.map(normalizeTime).filter(Boolean))]}

async function fetchText(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36","Accept":"text/html,application/xhtml+xml","Accept-Language":"en-US,en;q=0.9"},redirect:"follow",signal:controller.signal});
    if(!r.ok)throw new Error(`${r.status} from ${new URL(url).hostname}`);
    return await r.text();
  }finally{clearTimeout(timer)}
}

// Each London Box Office listing is wrapped in an element carrying data-name; prefer that.
// Fallback walks up looking for the capitalised "Performances" label only: a lowercase
// "performances" inside a show blurb used to stop the walk one level too early.
function bestContainer($,el){const li=$(el).closest("[data-name]");if(li.length)return li;let node=$(el);for(let i=0;i<8&&node.length;i++){const t=node.text();if(/Performances/.test(t)&&/Playing at:/i.test(t))return node;node=node.parent()}return $(el).parent()}
function matchKey(s){return normalizeTitle(s).replace(/themusical$/,"").replace(/musical$/,"")}
function looksNonMusical(title,cats){return cats.includes("o")||/ballet|opera|dance|tango|flamenco|circus|cirque|in concert|live!?$|comedy/i.test(title)}

async function scrapeLondonDay(date){
  const [y,m,d]=date.split("-");
  const musicalUrl=`https://www.londontheatre.co.uk/whats-on/musicals?date=${date}`;
  const timesUrl=`https://www.londonboxoffice.co.uk/search/london-shows/${y}/${m}/${d}/2`;
  const [musicalHtml,timesHtml]=await Promise.all([fetchText(musicalUrl),fetchText(timesUrl)]);

  const $m=cheerio.load(musicalHtml);
  const musicalNames=new Map();
  // Real show links on londontheatre.co.uk look like /show/46308-billy-elliot-the-musical.
  // Select by href, not by link text: a text filter on the word "musical" used to discard
  // every title containing it (Billy Elliot the Musical, Matilda The Musical, SIX the Musical...).
  $m("main a[href*='/show/'], article a[href*='/show/'], [role='main'] a[href*='/show/']").each((_,a)=>{
    if($m(a).closest("nav, header, footer").length)return;
    const text=$m(a).text().replace(/\s+/g," ").trim();
    const href=$m(a).attr("href")||"";
    if(!text||text.length>100)return;
    if(!/\/show\/\d+/.test(href))return;
    if(/^(from\s*£|£)/i.test(text))return;
    const n=normalizeTitle(text);
    if(n.length>=3&&!musicalNames.has(n))musicalNames.set(n,{name:text,href:absolute(musicalUrl,href)});
  });

  const $=cheerio.load(timesHtml);
  const performances=[];
  const foundShows=new Map();
  $("h2,h3,h4").each((_,h)=>{
    const title=$(h).text().replace(/\s+/g," ").trim();
    if(!title||title.length>120)return;
    const container=bestContainer($,h);
    const block=container.text().replace(/\s+/g," ").trim();
    if(!/Performances/i.test(block))return;
    const norm=normalizeTitle(title);
    const key=matchKey(title);
    let musical=musicalNames.get(norm);
    if(!musical){for(const [k,v] of musicalNames){const kk=matchKey(v.name);if(k===norm||kk===key||(kk.length>5&&key.length>5&&(kk.includes(key)||key.includes(kk)))){musical=v;break}}}
    // Safety net: London Box Office tags each listing with categories; "m" covers musicals
    // but also opera/ballet/dance, so filter those out by category and title.
    if(!musical){
      const item=container.is("[data-categories]")?container:container.closest("[data-categories]");
      const cats=String(item.attr("data-categories")||"").split(/\s+/).filter(Boolean);
      if(cats.includes("m")&&!looksNonMusical(title,cats))musical={name:title,href:""};
    }
    if(!musical)return;
    const times=extractTimes(block);
    if(!times.length)return;
    let venue="";
    const vm=block.match(/Playing at:\s*(.*?)(?:Booking until:|Starring:|Performances|Tickets from|$)/i);
    if(vm)venue=vm[1].trim();
    let ticketUrl="";
    container.find("a").each((_,a)=>{if(ticketUrl)return;const at=$(a).text().trim();const href=$(a).attr("href");if(href&&/\bBook\b/i.test(at))ticketUrl=absolute(timesUrl,href)});
    const show={name:musical.name||title,venue:venue||"London",ticketUrl:ticketUrl||timesUrl,infoUrl:musical.href||musicalUrl};
    foundShows.set(normalizeTitle(show.name),show);
    times.forEach(time=>performances.push([show.name,time]));
  });

  if(!performances.length){
    for(const [,musical] of musicalNames){
      const name=musical.name;
      const idx=timesHtml.toLowerCase().indexOf(name.toLowerCase());
      if(idx<0)continue;
      const chunk=cheerio.load(timesHtml.slice(Math.max(0,idx-1000),idx+5000)).text();
      const times=extractTimes(chunk);
      if(!times.length)continue;
      const show={name,venue:"London",ticketUrl:timesUrl,infoUrl:musical.href||musicalUrl};
      foundShows.set(normalizeTitle(name),show);
      times.forEach(time=>performances.push([name,time]));
    }
  }
  return {date,performances,shows:[...foundShows.values()]};
}

async function scrapeLondonRange(start,end){
  const dates=rangeDates(start,end);
  const schedule=Object.fromEntries(dates.map(d=>[d,[]]));
  const shows=new Map();
  const results=[];
  for(let i=0;i<dates.length;i+=4){const batch=await Promise.all(dates.slice(i,i+4).map(scrapeLondonDay));results.push(...batch)}
  for(const r of results){schedule[r.date]=r.performances;r.shows.forEach(show=>shows.set(normalizeTitle(show.name),show))}
  // Fallback: musicals LBO sells but leaves off its day pages (e.g. Rent, Sept 2026).
  // Same tolerant matching as the day pages, so "Six" vs "SIX the Musical" is not a duplicate.
  const foundKeys=[...shows.values()].map(s=>matchKey(s.name));
  const isFound=name=>{const k=matchKey(name);return foundKeys.some(f=>f===k||(f.length>5&&k.length>5&&(f.includes(k)||k.includes(f))))};
  const extra=await findMissingPerformances({dates,isFound,fetchText});
  for(const show of extra.shows)shows.set(normalizeTitle(show.name),show);
  for(const [d,list] of Object.entries(extra.performances))if(schedule[d])schedule[d].push(...list);
  for(const d of dates){const seen=new Set();schedule[d]=schedule[d].filter(([n,t])=>{const k=`${normalizeTitle(n)}|${t}`;if(seen.has(k))return false;seen.add(k);return true})}
  // Ticket links point at SeatPlan; the original London Box Office link is kept as sourceTicketUrl.
  const showList=await applySeatPlanLinks("london",[...shows.values()]);
  await enrichMissingShowInfo(showList,"LondonTheatre.co.uk");
  return {shows:showList,schedule,sources:["LondonTheatre.co.uk (musical listings)","London Box Office (performance times)","SeatPlan (ticket links)"]};
}

export default async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"GET only"});
  const city=String(req.query.city||"").toLowerCase();

  if(city==="broadway"){
    return broadwayHandler(req,res);
  }

  if(city!=="london")return json(res,400,{error:"city must be london or broadway"});
  const start=parseISO(String(req.query.start||""));
  const end=parseISO(String(req.query.end||""));
  if(!start||!end||start>end)return json(res,400,{error:"Invalid start/end dates"});
  const dayCount=Math.floor((end-start)/86400000)+1;
  if(dayCount>21)return json(res,400,{error:"Please select a date range of 21 days or fewer for live searching."});
  const key=`london|${iso(start)}|${iso(end)}`;
  const cached=cache.get(key);
  if(cached&&Date.now()-cached.at<CACHE_TTL_MS)return json(res,200,cached.data);

  try{
    const result=await scrapeLondonRange(start,end);
    const data={city:"london",start:iso(start),end:iso(end),refreshedAt:new Date().toISOString(),...result};
    cache.set(key,{at:Date.now(),data});
    return json(res,200,data);
  }catch(err){
    console.error("London schedule failed:",err);
    return json(res,502,{error:"The London schedule source could not be read right now.",detail:String(err?.message||err)});
  }
}
