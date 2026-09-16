import fs from 'node:fs';

// Shareable itineraries (build-time patch, runs right after patch-index.mjs).
//   index.html      -> "Share plan" button in the trip bar + "Share link" in the export panel,
//                      the share dialog (#shareOverlay) and the JS that POSTs the plan to /api/plan.
//   date-calendar.js-> on load, /?plan=CODE fetches /api/plan?code=CODE and imports it via applyPlan().
// Server side: lib/plans.js (Neon), api/plan.js, api/plan-page.js (/plan/<code>), api/og.js?plan=CODE.

function patchFile(file, edits) {
  let s = fs.readFileSync(file, 'utf8');
  for (const [label, search, replacement] of edits) {
    const n = s.split(search).length - 1;
    if (n !== 1) { console.error(`patch-share-plan: expected exactly one match for "${label}" in ${file}, found ${n}`); process.exit(1); }
    s = s.replace(search, () => replacement);
  }
  fs.writeFileSync(file, s);
}

// ---------- index.html ----------
const html = fs.readFileSync('index.html', 'utf8');
if (html.includes('SHARE_PLAN_PATCH')) {
  console.log('patch-share-plan: index.html already patched.');
} else {
  patchFile('index.html', [
    ['trip bar button',
      '<button id="clearAllBtnTop" class="danger">Clear all selections</button><button id="finishBtn" class="primary">Finish planning</button>',
      '<button id="clearAllBtnTop" class="danger">Clear all selections</button><button id="shareBtn">Share plan</button><button id="finishBtn" class="primary">Finish planning</button>'],

    ['export panel button',
      '<button id="excelBtn" class="primary">Export to Excel</button><button id="pdfBtn" class="primary">Export to PDF</button><button id="returnBtn">Return to planner</button>',
      '<button id="excelBtn" class="primary">Export to Excel</button><button id="pdfBtn" class="primary">Export to PDF</button><button id="shareBtn2">Share link</button><button id="returnBtn">Return to planner</button>'],

    ['share overlay',
      '<div id="clearOverlay" class="overlay hidden">',
      '<div id="shareOverlay" class="overlay hidden"><div class="modal"><h2>Share your plan</h2><p id="shareText" class="small"></p><div id="shareReady" class="hidden"><input id="shareLink" class="share-link" readonly aria-label="Shareable link"><div class="actions share-actions"><button id="shareCopy" class="primary">Copy link</button><a id="shareWhatsApp" class="share-wa" target="_blank" rel="noopener">Send on WhatsApp</a><button id="shareNative" class="hidden">Share…</button></div><p class="small">Anyone with the link can see the plan and open it in their own planner. Ticket confirmations you attached are not included.</p></div><div class="actions"><button id="shareClose">Close</button></div></div></div>\n<div id="clearOverlay" class="overlay hidden">'],

    ['share css',
      '.saved-notice{',
      '.share-link{width:100%;border:1px solid var(--line);border-radius:10px;padding:11px 12px;background:#fff;color:var(--ink);font-size:15px;margin-top:6px}.share-actions{justify-content:flex-start}.share-wa{display:inline-flex;align-items:center;min-height:38px;padding:0 14px;border-radius:10px;background:#25d366;color:#fff;font-weight:600;text-decoration:none;font-size:14px}.saved-notice{'],

    ['share js',
      'function selectedRows(){',
      `// SHARE_PLAN_PATCH
function tripRanges(){const segs=typeof window.tripSegments==='function'?window.tripSegments():[];return segs.length?segs:(state.start&&state.end?[{start:state.start,end:state.end}]:[])}
function planPayload(){const ranges=tripRanges(),out={};for(const [d,s] of Object.entries(choices())){if(!s||!ranges.some(r=>d>=r.start&&d<=r.end))continue;const day={};for(const sess of ['matinee','evening']){const c=s[sess];if(c&&c.name)day[sess]={name:c.name,time:c.time||'',venue:c.venue||'',address:c.address||(typeof venueAddress==='function'?venueAddress(c.venue||'',c):''),ticketUrl:c.ticketUrl||'',infoUrl:c.infoUrl||'',venueUrl:c.venueUrl||''}}if(Object.keys(day).length)out[d]=day}return{city:state.city,ranges,choices:out}}
function countPayload(p){return Object.values(p.choices).reduce((n,d)=>n+(d.matinee?1:0)+(d.evening?1:0),0)}
async function openShare(){const p=planPayload(),n=countPayload(p);$('shareReady').classList.add('hidden');$('shareOverlay').classList.remove('hidden');if(!p.ranges.length){$('shareText').textContent='Choose your trip dates first.';return}if(!n){$('shareText').textContent=\`Choose at least one performance for your \${cityShort()} trip first, then share.\`;return}$('shareText').textContent='Creating your link…';try{const r=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const data=await r.json().catch(()=>({}));if(!r.ok||!data.url)throw new Error(data.error||\`Share service returned \${r.status}\`);const msg=\`My musical trip plan — \${data.title}\\n\${data.url}\`;$('shareLink').value=data.url;$('shareWhatsApp').href=\`https://wa.me/?text=\${encodeURIComponent(msg)}\`;$('shareText').textContent=\`\${data.title}. \${n} performance\${n===1?'':'s'} included.\`;$('shareCopy').textContent='Copy link';const canShare=typeof navigator.share==='function';$('shareNative').classList.toggle('hidden',!canShare);$('shareNative').onclick=()=>navigator.share({title:'My musical trip plan',text:msg,url:data.url}).catch(()=>{});$('shareReady').classList.remove('hidden')}catch(e){console.error(e);$('shareText').textContent=\`Sorry, the link could not be created: \${e.message}\`}}
async function copyShareLink(){const v=$('shareLink').value;try{await navigator.clipboard.writeText(v)}catch{$('shareLink').select();try{document.execCommand('copy')}catch{}}$('shareCopy').textContent='Copied ✓';setTimeout(()=>$('shareCopy').textContent='Copy link',2000)}
function selectedRows(){`],

    ['share wiring',
      "$('finishBtn').onclick=()=>{",
      "$('shareBtn').onclick=openShare;$('shareBtn2').onclick=()=>{$('finishOverlay').classList.add('hidden');openShare()};$('shareClose').onclick=()=>$('shareOverlay').classList.add('hidden');$('shareCopy').onclick=copyShareLink;$('finishBtn').onclick=()=>{"]
  ]);
  console.log('patch-share-plan: index.html patched (Share button, dialog, /api/plan client).');
}

// ---------- date-calendar.js ----------
const js = fs.readFileSync('date-calendar.js', 'utf8');
if (js.includes('importSharedPlan')) {
  console.log('patch-share-plan: date-calendar.js already patched.');
} else {
  patchFile('date-calendar.js', [
    ['plan import',
      "  renderCities();\n  showSavedNotice();\n})();",
      `  renderCities();
  showSavedNotice();

  // Shared itinerary import: /?plan=CODE copies a saved plan (from /plan/CODE) into this browser and opens it.
  (async function importSharedPlan() {
    const code = new URLSearchParams(location.search).get('plan');
    if (!code || !/^[a-z0-9]{4,12}$/i.test(code)) return;
    history.replaceState(null, '', location.pathname);
    $('savedNotice').classList.add('hidden');
    setLoading(true, 'Loading the shared plan…');
    try {
      const r = await fetch(\`/api/plan?code=\${encodeURIComponent(code.toLowerCase())}\`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.plan) throw new Error(data.error || \`Plan service returned \${r.status}\`);
      const plan = data.plan;
      if (!['london', 'broadway'].includes(plan.city) || !Array.isArray(plan.ranges) || !plan.ranges.length) throw new Error('Plan is incomplete');
      state.choices[plan.city] = { ...(state.choices[plan.city] || {}), ...plan.choices };
      state.excluded[plan.city] = new Set();
      $('startCity').value = plan.city;
      await applyPlan({ city: plan.city, ranges: plan.ranges.map(r => ({ start: r.start, end: r.end })) });
      setStatus(\`Shared plan loaded: \${data.title || plan.city}. It is now saved in this browser and you can change or export it.\`, 'ok');
    } catch (e) {
      console.error(e);
      setLoading(false);
      setStatus(\`Could not load the shared plan: \${e.message}\`, 'error');
    }
  })();
})();`]
  ]);
  console.log('patch-share-plan: date-calendar.js patched (?plan= import).');
}
