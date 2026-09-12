import * as cheerio from "cheerio";

// Diagnostic endpoint (branch only). Mirrors the London logic in schedule.js
// and reports, per candidate, why it was kept or dropped.
// GET /api/debug-london?date=YYYY-MM-DD[&show=billy]

function normalizeTitle(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/&/g,"and").replace(/^the\s+/,"").replace(/[^a-z0-9]+/g,"").trim()}
function absolute(base,href){if(!href)return"";try{return new URL(href,base).href}catch{return""}}
function normalizeTime(raw){const m=String(raw||"").trim().match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);if(!m)return null;let h=Number(m[1]),min=m[2],ap=m[3].toLowerCase();if(ap==="pm"&&h!==12)h+=12;if(ap==="am"&&h===12)h=0;return `${String(h).padStart(2,"0")}:${min}`}
function extractTimes(text){const matches=String(text||"").match(/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/gi)||[];return [...new Set(matches.map(normalizeTime).filter(Boolean))]}
function bestContainer($,el){let node=$(el);for(let i=0;i<8&&node.length;i++){const t=node.text();if(/Performances/i.test(t)&&/Playing at:/i.test(t))return node;node=node.parent()}return $(el).parent()}

async function fetchText(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36","Accept":"text/html,application/xhtml+xml","Accept-Language":"en-US,en;q=0.9"},redirect:"follow",signal:controller.signal});
    const text=await r.text();
    return {status:r.status,ok:r.ok,length:text.length,text};
  }catch(e){
    return {status:0,ok:false,length:0,text:"",error:String(e&&e.message||e)};
  }finally{clearTimeout(timer)}
}

export default async function handler(req,res){
  const date=String(req.query.date||"");
  const needle=String(req.query.show||"billy").toLowerCase();
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){res.status(400);return res.end(JSON.stringify({error:"date=YYYY-MM-DD required"}))}
  const [y,m,d]=date.split("-");
  const musicalUrl=`https://www.londontheatre.co.uk/whats-on/musicals?date=${date}`;
  const timesUrl=`https://www.londonboxoffice.co.uk/search/london-shows/${y}/${m}/${d}/2`;
  const [musical,times]=await Promise.all([fetchText(musicalUrl),fetchText(timesUrl)]);

  // Source 1: musical names
  const $m=cheerio.load(musical.text);
  const musicalNames=new Map();
  const rejectedLinks=[];
  $m("main a, article a, [role='main'] a").each((_,a)=>{
    const text=$m(a).text().replace(/\s+/g," ").trim();
    const href=$m(a).attr("href")||"";
    if(!text||text.length>100)return;
    if(/news|review|ticket|today|weekend|musical|west end|theatre week|all shows/i.test(text)){
      if(text.toLowerCase().includes(needle))rejectedLinks.push({text,href,reason:"text matched the exclusion regex (news|review|ticket|today|weekend|musical|west end|theatre week|all shows)"});
      return;
    }
    if(/\/(show|shows|tickets|theatre)\b/i.test(href)||href.startsWith("/")){
      const n=normalizeTitle(text);
      if(n.length>=3)musicalNames.set(n,{name:text,href:absolute(musicalUrl,href)});
    }else if(text.toLowerCase().includes(needle)){
      rejectedLinks.push({text,href,reason:"href did not match /show|shows|tickets|theatre/ and is not relative"});
    }
  });

  // Source 2: headings on the day page
  const $=cheerio.load(times.text);
  const headings=[];
  $("h2,h3,h4").each((_,h)=>{
    const title=$(h).text().replace(/\s+/g," ").trim();
    if(!title||title.length>120)return;
    const container=bestContainer($,h);
    const block=container.text().replace(/\s+/g," ").trim();
    const hasPerformances=/Performances/i.test(block);
    const hasPlayingAt=/Playing at:/i.test(block);
    const norm=normalizeTitle(title);
    let musical=musicalNames.get(norm)?"exact":null;
    if(!musical){for(const [k] of musicalNames){if(k===norm||(k.length>5&&norm.length>5&&(k.includes(norm)||norm.includes(k)))){musical="fuzzy:"+k;break}}}
    const timesFound=extractTimes(block);
    let verdict="kept";
    if(!hasPerformances)verdict="dropped: container has no 'Performances' text";
    else if(!musical)verdict="dropped: title not matched to any londontheatre.co.uk musical";
    else if(!timesFound.length)verdict="dropped: no h:mm am/pm times in container";
    let perfHtml=null;
    if(title.toLowerCase().includes(needle)){
      const raw=String(container.html()||"");
      const pi=raw.indexOf("Performances");
      perfHtml=raw.slice(Math.max(0,pi-200),pi+2500).replace(/\s+/g," ").replace(/https?:\/\/[^\s"']+/g,"URL");
    }
    const item=container.is("[data-categories]")?container:container.closest("[data-categories]");
    const cats=String(item.attr("data-categories")||"");
    headings.push({tag:h.tagName,title,norm,matched:musical,cats,hasPerformances,hasPlayingAt,times:timesFound,verdict,blockPreview:block.slice(0,220),perfHtml});
  });

  const needleInTimesHtml=(times.text.toLowerCase().match(new RegExp(needle,"g"))||[]).length;
  const needleInMusicalHtml=(musical.text.toLowerCase().match(new RegExp(needle,"g"))||[]).length;
  const idx=times.text.toLowerCase().indexOf(needle);
  const rawContext=idx>=0?times.text.slice(Math.max(0,idx-600),idx+1200):null;

  res.status(200);
  res.end(JSON.stringify({
    date,
    sources:{
      londontheatre:{url:musicalUrl,status:musical.status,length:musical.length,error:musical.error||null,needleOccurrences:needleInMusicalHtml},
      londonboxoffice:{url:timesUrl,status:times.status,length:times.length,error:times.error||null,needleOccurrences:needleInTimesHtml}
    },
    musicalNamesCount:musicalNames.size,
    musicalNamesMatchingNeedle:[...musicalNames.values()].filter(v=>v.name.toLowerCase().includes(needle)),
    rejectedLinksMatchingNeedle:rejectedLinks,
    headingsCount:headings.length,
    headingsMatchingNeedle:headings.filter(h=>h.title.toLowerCase().includes(needle)),
    keptSummary:headings.filter(h=>h.verdict==="kept").map(h=>({title:h.title,times:h.times})),
    droppedSummary:headings.filter(h=>h.verdict!=="kept"&&h.hasPerformances).map(h=>({title:h.title,verdict:h.verdict})),
    rawContextAroundNeedleInTimesHtml:rawContext
  },null,2));
}
