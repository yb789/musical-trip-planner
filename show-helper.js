// Opening screen + "Help me choose" show helper.
// Routes: #/start (opening screen), #/helper (quiz), #/helper/results (shortlist), #/plan (planner).
// Show descriptions and tags come from window.SHOW_GUIDE (data/shows-*.json, inlined at build time).
// When live schedules are loaded, recommendations are limited to shows actually playing on the trip dates.
(() => {
  const GUIDE = window.SHOW_GUIDE || { london: { shows: [] }, broadway: { shows: [] } };
  const CITIES = ['london', 'broadway'];
  const KEY = 'musicalPlannerHelper';
  const $id = id => document.getElementById(id);
  const h = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const QUESTIONS = [
    { key: 'who', q: 'Who’s coming?', opts: [
      ['solo', 'Just me', 'A solo trip, happy to see anything'],
      ['couple', 'The two of us', 'A date night or a couple’s trip'],
      ['family', 'Family with kids', 'Needs to work for younger audiences'],
      ['group', 'A group of friends', 'Something fun to share']] },
    { key: 'vibe', q: 'What kind of night out?', opts: [
      ['spectacle', 'Big spectacle', 'Huge sets, effects and wow moments'],
      ['feelgood', 'Feel-good and singalong', 'Songs you know, leave smiling'],
      ['emotional', 'A moving story', 'A score and story that stay with you'],
      ['edgy', 'Funny and irreverent', 'Sharp, cheeky, a bit edgy']] },
    { key: 'known', q: 'A classic, or something newer?', opts: [
      ['classic', 'A show I’ve heard of', 'Famous titles and long-running hits'],
      ['new', 'Something newer', 'Recent and lesser-known shows'],
      ['either', 'Surprise me', 'Either is fine']] },
    { key: 'count', q: 'How many shows are you planning to see?', opts: [
      ['few', '1–2 shows', 'A short trip or a single night'],
      ['some', '3–4 shows', 'A long weekend'],
      ['many', '5 or more', 'A full theatre holiday']] }
  ];
  const RESULT_COUNT = { few: 3, some: 5, many: 8 };
  const VIBE_WHY = { spectacle: 'big spectacle', feelgood: 'feel-good', emotional: 'a moving story', edgy: 'funny and irreverent' };
  const VIBE_PILL = { spectacle: 'Spectacle', feelgood: 'Feel-good', emotional: 'Moving', edgy: 'Funny & irreverent' };
  const AUD_PILL = { family: 'Family-friendly', teens: 'Teens and up', adults: 'Adults' };
  const WHO_LBL = { solo: 'just you', couple: 'the two of you', family: 'family with kids', group: 'a group of friends' };
  const KNOWN_LBL = { classic: 'well-known shows', new: 'newer shows', either: 'any show' };

  // ---------- state ----------
  const hs = { city: 'london', step: 0, ans: {}, short: { london: [], broadway: [] }, hearts: new Set(), screen: '' };
  try {
    const x = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (CITIES.includes(x.city)) hs.city = x.city;
    else if (typeof state !== 'undefined' && CITIES.includes(state.city)) hs.city = state.city;
    if (x.ans && typeof x.ans === 'object') hs.ans = x.ans;
    for (const c of CITIES) if (Array.isArray(x.short?.[c])) hs.short[c] = x.short[c].filter(v => typeof v === 'string');
  } catch {}
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify({ city: hs.city, ans: hs.ans, short: hs.short })); } catch {}
  }

  // ---------- matching live show names to guide entries ----------
  function key(s) {
    return String(s || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/&/g, 'and')
      .replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '').replace(/(anewmusical|themusical|musical)$/, '');
  }
  for (const c of CITIES) for (const g of GUIDE[c]?.shows || []) g._keys = [...new Set([g.title, ...(g.match || [])].map(key).filter(Boolean))];
  const guide = city => GUIDE[city]?.shows || [];
  const byId = (city, id) => guide(city).find(g => g.id === id);
  function entryForName(city, name) {
    const k = key(name);
    if (!k) return null;
    return guide(city).find(g => g._keys.includes(k)) || guide(city).find(g => g._keys.some(x => x.length > 5 && k.length > 5 && (x.includes(k) || k.includes(x)))) || null;
  }
  function liveKeys(city) {
    try {
      if (!state.start || !state.end) return null;
      const shows = state.data?.[city]?.shows || [];
      if (!shows.length) return null;
      const set = new Set();
      for (const s of shows) { const g = entryForName(city, s.name); if (g) set.add(g.id); }
      return set;
    } catch { return null; }
  }
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  function candidates(city) {
    const live = liveKeys(city);
    if (live) return { list: guide(city).filter(g => live.has(g.id)), live: true };
    const t = todayISO();
    return { list: guide(city).filter(g => g.status !== 'upcoming' && !(g.bookingUntil && g.bookingUntil < t)), live: false };
  }

  function rank(city) {
    const a = hs.ans;
    const { list, live } = candidates(city);
    const scored = list.map(g => {
      let score = 0; const why = [];
      if ((g.vibes || []).includes(a.vibe)) { score += 3; why.push(VIBE_WHY[a.vibe]); }
      if (a.who === 'family') {
        if (g.audience === 'adults') score -= 10;
        else if (g.audience === 'family') { score += 3; why.push('works for families'); }
        else score -= 1;
      }
      if (a.who === 'couple' && (g.vibes || []).includes('emotional')) { score += 1; why.push('a good date night'); }
      if (a.who === 'group' && (g.vibes || []).some(v => v === 'feelgood' || v === 'edgy')) { score += 1; why.push('fun with friends'); }
      if (a.known === 'classic' && g.familiar) { score += 2; why.push('a show most people have heard of'); }
      if (a.known === 'new' && !g.familiar) { score += 2; why.push('a newer or lesser-known pick'); }
      return { g, score, why };
    });
    scored.sort((x, y) => y.score - x.score || (y.g.familiar ? 1 : 0) - (x.g.familiar ? 1 : 0) || x.g.title.localeCompare(y.g.title));
    return { items: scored.slice(0, RESULT_COUNT[a.count] || 5), live, total: list.length };
  }

  // ---------- overlay ----------
  const overlay = document.createElement('div');
  overlay.id = 'helperOverlay';
  overlay.className = 'mh-overlay hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'mhTitle');
  overlay.innerHTML = `<div class="mh-top"><div class="wrap"><p class="mh-brand">Musical Trip Planner</p><div class="mh-tag">West End &amp; Broadway, planned by date</div></div></div><div class="mh-scroll" id="mhScroll"><div id="mhBody"></div></div>`;
  document.body.appendChild(overlay);
  const body = $id('mhBody');

  const ICON_CAL = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#1f4b3f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';
  const ICON_SPARK = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#7c2d12" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>';
  const heart = on => `<svg viewBox="0 0 24 24" fill="${on ? '#7c2d12' : 'none'}" stroke="#7c2d12" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>`;
  const cityName = c => c === 'london' ? 'London' : 'New York';
  const fmtDate = iso => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return iso; } };

  function focusTitle() {
    const t = $id('mhTitle');
    $id('mhScroll').scrollTop = 0;
    if (t) t.focus({ preventScroll: true });
  }
  function savedShowCount() {
    try { return typeof savedSelectionSummary === 'function' ? savedSelectionSummary().shows : 0; } catch { return 0; }
  }

  function renderWelcome() {
    const saved = savedShowCount();
    const shortN = (hs.short[hs.city] || []).length;
    body.innerHTML = `<div class="mh-wrap">
      <div class="mh-center"><h1 id="mhTitle" class="mh-h1" tabindex="-1">Where would you like to start?</h1><p class="mh-sub">Plan a trip to see musicals in London or New York.</p></div>
      <div class="mh-cities" role="group" aria-label="City">
        ${CITIES.map(c => `<button type="button" data-act="city" data-city="${c}" aria-pressed="${hs.city === c}">${c === 'london' ? 'London · West End' : 'New York · Broadway'}</button>`).join('')}
      </div>
      <div class="mh-paths">
        <button type="button" class="mh-card" data-act="know"><span class="mh-icon">${ICON_CAL}</span><span class="mh-card-title">I know what I want</span><span class="mh-card-text">Pick your dates and choose a matinee and an evening show for each day.</span><span class="mh-card-cta">Go to the planner →</span></button>
        <button type="button" class="mh-card mh-feature" data-act="help"><span class="mh-card-top"><span class="mh-icon">${ICON_SPARK}</span><span class="mh-chip">About 1 minute</span></span><span class="mh-card-title">Help me choose</span><span class="mh-card-text">Not sure what to see? Answer 4 quick questions and get a shortlist of shows that suit you.</span><span class="mh-card-cta">Start the helper →</span></button>
      </div>
      ${shortN ? `<div class="mh-note mh-green"><div>You have a shortlist of <b>${shortN} ${cityName(hs.city)} show${shortN === 1 ? '' : 's'}</b> from the helper.</div><button type="button" class="mh-btn" data-act="showresults">See my shortlist</button></div>` : ''}
      ${saved ? `<div class="mh-note"><div><b>Welcome back.</b> This browser has ${saved} chosen performance${saved === 1 ? '' : 's'} saved from a previous visit.</div><button type="button" class="mh-btn primary" data-act="know">Continue your plan</button></div>` : ''}
    </div>`;
  }

  function renderQuiz() {
    const q = QUESTIONS[hs.step];
    const picked = hs.ans[q.key];
    const pct = Math.round(((hs.step + 1) / QUESTIONS.length) * 100);
    body.innerHTML = `<div class="mh-wrap mh-narrow">
      <div class="mh-progress"><div class="mh-progress-row"><span>Question ${hs.step + 1} of ${QUESTIONS.length}</span><span>${cityName(hs.city)}</span></div><div class="mh-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div></div>
      <h2 id="mhTitle" class="mh-h2" tabindex="-1">${h(q.q)}</h2>
      <div class="mh-options">${q.opts.map(o => `<button type="button" class="mh-option" data-act="answer" data-val="${o[0]}" aria-pressed="${picked === o[0]}"><b>${h(o[1])}</b><span>${h(o[2])}</span></button>`).join('')}</div>
      <div class="mh-row"><button type="button" class="mh-btn" data-act="back">← Back</button><p class="small">${hs.step < QUESTIONS.length - 1 ? 'Tap an answer to go to the next question' : 'Tap an answer to see your shows'}</p></div>
    </div>`;
  }

  function renderResults() {
    const { items, live } = rank(hs.city);
    const basis = [WHO_LBL[hs.ans.who], VIBE_WHY[hs.ans.vibe], KNOWN_LBL[hs.ans.known]].filter(Boolean).join(' · ');
    const hearted = items.filter(x => hs.hearts.has(x.g.id)).length;
    const planN = hearted || items.length;
    const scope = live ? `Only shows playing between ${h(fmtDate(state.start))} and ${h(fmtDate(state.end))} are included.` : 'Pick your dates next and the planner will show which days each one is playing.';
    body.innerHTML = `<div class="mh-wrap">
      <div class="mh-row"><div><h2 id="mhTitle" class="mh-h2" tabindex="-1">Your shortlist for ${cityName(hs.city)}</h2><p class="mh-sub">Based on: ${h(basis)}. Tap the heart on the shows you want, or plan them all.</p></div><button type="button" class="mh-btn" data-act="retake">Change answers</button></div>
      ${items.length ? `<div class="mh-grid">${items.map(({ g, why }) => {
        const on = hs.hearts.has(g.id);
        const pills = [AUD_PILL[g.audience], ...(g.vibes || []).map(v => VIBE_PILL[v]), g.runtime].filter(Boolean);
        const meta = g.limitedRun && g.dates ? `<div class="mh-meta">Limited run · ${h(g.dates)}</div>` : '';
        return `<article class="mh-show${on ? ' on' : ''}"><div class="mh-show-head"><div><div class="mh-show-title">${h(g.title)}</div><div class="mh-show-venue">${h(g.venue)}</div></div><button type="button" class="mh-heart" data-act="heart" data-id="${h(g.id)}" aria-pressed="${on}" aria-label="${on ? 'Remove' : 'Add'} ${h(g.title)} ${on ? 'from' : 'to'} your shortlist">${heart(on)}</button></div>
          <div class="mh-pills">${pills.map(p => `<span class="pill">${h(p)}</span>`).join('')}</div>
          <p class="mh-blurb">${h(g.blurb)}</p>
          <div class="mh-why"><b>Why it fits:</b> ${h(why.length ? why.join(' · ') : 'a popular pick in ' + cityName(hs.city))}</div>${meta}
          <a class="mh-listen" href="https://open.spotify.com/search/${encodeURIComponent(g.listen || g.title)}" target="_blank" rel="noopener">Listen to the cast recording ↗</a></article>`;
      }).join('')}</div>` : `<div class="mh-empty">No shows in our guide match these dates yet. Try the planner directly, it lists everything that is playing.</div>`}
      <p class="small">${scope} Descriptions are our own short summaries; check each show’s age guidance before booking.</p>
      <div class="mh-footer"><div><b>${hearted ? `${hearted} shortlisted` : 'Nothing hearted yet'}</b> <span class="small">${hearted ? '· these go into your plan' : '· we’ll plan all of these'}</span></div><button type="button" class="mh-btn primary" data-act="plan"${items.length ? '' : ' disabled'}>Plan ${planN} show${planN === 1 ? '' : 's'} →</button></div>
    </div>`;
  }

  function show(screen) {
    hs.screen = screen;
    overlay.classList.remove('hidden');
    document.body.classList.add('mh-open');
    if (screen === 'welcome') renderWelcome();
    else if (screen === 'quiz') renderQuiz();
    else renderResults();
    focusTitle();
  }
  function hideOverlay() {
    hs.screen = '';
    overlay.classList.add('hidden');
    document.body.classList.remove('mh-open');
  }

  // ---------- going to the planner ----------
  function setPlannerCity(city) {
    const sel = $id('startCity');
    if (sel) sel.value = city;
  }
  function updateDateNote() {
    const modal = document.querySelector('#dateOverlay .modal');
    if (!modal) return;
    let note = $id('mhDateNote');
    const sel = $id('startCity');
    const city = sel && CITIES.includes(sel.value) ? sel.value : hs.city;
    const titles = (hs.short[city] || []).map(id => byId(city, id)?.title).filter(Boolean);
    if (!titles.length) { if (note) note.remove(); return; }
    if (!note) {
      note = document.createElement('div');
      note.id = 'mhDateNote';
      note.className = 'mh-note mh-green';
      const h2 = modal.querySelector('h2');
      h2 ? h2.after(note) : modal.prepend(note);
    }
    note.innerHTML = `<div><b>Your shortlist:</b> ${titles.map(h).join(', ')}. Pick your dates and we’ll show which days they’re playing.</div>`;
  }
  function goPlanner(city) {
    if (location.hash !== '#/plan') location.hash = '#/plan';
    else hideOverlay();
    const planning = !!(state.start && state.end);
    if (planning) {
      if (state.city !== city) { const b = $id(city === 'london' ? 'londonBtn' : 'broadwayBtn'); if (b) b.click(); }
      else refreshPlanner();
    } else {
      setPlannerCity(city);
      updateDateNote();
      $id('dateOverlay')?.classList.remove('hidden');
    }
  }

  // ---------- events ----------
  let advanceTimer = null;
  overlay.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'city') { hs.city = b.dataset.city; persist(); renderWelcome(); overlay.querySelector(`[data-city="${hs.city}"]`)?.focus(); }
    else if (act === 'know') goPlanner(hs.city);
    else if (act === 'help') { hs.step = 0; location.hash = '#/helper'; }
    else if (act === 'showresults') { hs.hearts = new Set(hs.short[hs.city]); location.hash = hs.ans.vibe ? '#/helper/results' : '#/helper'; }
    else if (act === 'answer') {
      const q = QUESTIONS[hs.step];
      hs.ans[q.key] = b.dataset.val;
      persist();
      overlay.querySelectorAll('.mh-option').forEach(o => o.setAttribute('aria-pressed', String(o === b)));
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => {
        if (hs.step < QUESTIONS.length - 1) { hs.step++; renderQuiz(); focusTitle(); }
        else { hs.hearts = new Set(hs.short[hs.city]); location.hash = '#/helper/results'; }
      }, 260);
    }
    else if (act === 'back') {
      clearTimeout(advanceTimer);
      if (hs.step > 0) { hs.step--; renderQuiz(); focusTitle(); }
      else location.hash = '#/start';
    }
    else if (act === 'retake') { hs.step = 0; location.hash = '#/helper'; }
    else if (act === 'heart') {
      const id = b.dataset.id;
      hs.hearts.has(id) ? hs.hearts.delete(id) : hs.hearts.add(id);
      renderResults();
      overlay.querySelector(`[data-act="heart"][data-id="${CSS.escape(id)}"]`)?.focus();
    }
    else if (act === 'plan') {
      const { items } = rank(hs.city);
      const hearted = items.filter(x => hs.hearts.has(x.g.id)).map(x => x.g.id);
      hs.short[hs.city] = hearted.length ? hearted : items.map(x => x.g.id);
      persist();
      goPlanner(hs.city);
    }
  });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape' && hs.screen && hs.screen !== 'welcome') { e.preventDefault(); location.hash = '#/start'; }
  });

  // ---------- routing ----------
  function route() {
    const r = location.hash.replace(/^#/, '');
    if (r === '/helper/results') {
      if (!hs.ans.vibe || !hs.ans.count) { hs.step = 0; return show('quiz'); }
      return show('results');
    }
    if (r === '/helper') return show('quiz');
    if (r === '' || r === '/' || r === '/start') return show('welcome');
    hideOverlay();
    if (r === '/plan' && !(state.start && state.end)) { setPlannerCity(hs.city); updateDateNote(); }
  }
  window.addEventListener('hashchange', route);

  // ---------- planner decorations ----------
  function isShort(name) {
    const ids = hs.short[state.city] || [];
    if (!ids.length) return false;
    const g = entryForName(state.city, name);
    return !!(g && ids.includes(g.id));
  }
  function decorateSidebar() {
    const list = $id('musicalList');
    if (!list) return;
    const rows = [...list.querySelectorAll('.musical-row')];
    const top = [];
    for (const row of rows) {
      const label = row.querySelector('label[data-show]');
      if (!label || !isShort(label.dataset.show)) continue;
      row.classList.add('mh-short');
      const b = label.querySelector('b');
      if (b && !b.querySelector('.mh-badge')) b.insertAdjacentHTML('beforeend', '<span class="mh-badge">♥ Shortlist</span>');
      top.push(row);
    }
    for (let i = top.length - 1; i >= 0; i--) list.prepend(top[i]);
  }
  function decorateDay() {
    document.querySelectorAll('#matineeList .show-card, #eveningList .show-card').forEach(card => {
      const t = card.querySelector('.show-title[data-show]');
      if (!t || !isShort(t.dataset.show)) return;
      card.classList.add('mh-short-card');
      if (!t.querySelector('.mh-badge')) t.insertAdjacentHTML('beforeend', '<span class="mh-badge">♥ Shortlist</span>');
    });
  }
  function renderBanner() {
    const layout = document.querySelector('main .layout');
    if (!layout) return;
    let banner = $id('mhBanner');
    const ids = hs.short[state.city] || [];
    if (!state.start || !ids.length) { if (banner) banner.remove(); return; }
    if (!banner) {
      banner = document.createElement('section');
      banner.id = 'mhBanner';
      banner.className = 'mh-banner';
      banner.setAttribute('aria-label', 'Your shortlist');
      layout.before(banner);
      banner.addEventListener('click', onBannerClick);
    }
    const live = liveKeys(state.city);
    const entries = ids.map(id => byId(state.city, id)).filter(Boolean);
    const missing = live ? entries.filter(g => !live.has(g.id)) : [];
    const shows = state.data?.[state.city]?.shows || [];
    const onlyMode = shows.length > 0 && shows.every(s => isShort(s.name) ? !state.excluded[state.city].has(s.name) : state.excluded[state.city].has(s.name));
    banner.innerHTML = `<div class="mh-banner-head"><span class="mh-banner-title">♥ Your shortlist from the helper</span><div class="tools">
        <button type="button" data-bact="${onlyMode ? 'all' : 'only'}">${onlyMode ? 'Show all musicals' : 'Show only my shortlist'}</button>
        <button type="button" data-bact="edit">Edit shortlist</button>
        <button type="button" data-bact="clear">Remove shortlist</button></div></div>
      <div class="mh-banner-chips">${entries.map(g => `<span class="mh-chip${live && !live.has(g.id) ? ' off' : ''}">${h(g.title)}</span>`).join('')}</div>
      ${missing.length ? `<div class="small">${missing.map(g => h(g.title)).join(', ')} ${missing.length === 1 ? 'isn’t' : 'aren’t'} playing on your dates.</div>` : '<div class="small">Shortlisted shows are marked ♥ in the musicals list and in each day’s performances.</div>'}`;
  }
  function onBannerClick(e) {
    const b = e.target.closest('[data-bact]');
    if (!b) return;
    const act = b.dataset.bact;
    const shows = state.data?.[state.city]?.shows || [];
    if (act === 'only') { for (const s of shows) isShort(s.name) ? state.excluded[state.city].delete(s.name) : state.excluded[state.city].add(s.name); }
    else if (act === 'all') { for (const s of shows) state.excluded[state.city].delete(s.name); }
    else if (act === 'edit') { hs.city = state.city; hs.hearts = new Set(hs.short[hs.city]); location.hash = hs.ans.vibe ? '#/helper/results' : '#/helper'; return; }
    else if (act === 'clear') { hs.short[state.city] = []; persist(); }
    try { save(); } catch {}
    refreshPlanner();
  }
  function refreshPlanner() {
    try { renderSidebar(); renderDay(); } catch (e) { console.error(e); }
  }

  if (typeof window.renderSidebar === 'function') {
    const orig = window.renderSidebar;
    window.renderSidebar = function (...args) {
      const r = orig.apply(this, args);
      try { decorateSidebar(); renderBanner(); } catch (e) { console.error(e); }
      return r;
    };
  }
  if (typeof window.renderDay === 'function') {
    const orig = window.renderDay;
    window.renderDay = function (...args) {
      const r = orig.apply(this, args);
      try { decorateDay(); } catch (e) { console.error(e); }
      return r;
    };
  }

  // "Help me choose" entry point inside the planner.
  const tools = document.querySelector('.trip-bar .tools');
  if (tools && !$id('helperBtn')) {
    const btn = document.createElement('button');
    btn.id = 'helperBtn';
    btn.type = 'button';
    btn.textContent = 'Help me choose';
    btn.onclick = () => { hs.city = state.city; hs.step = 0; location.hash = '#/helper'; };
    tools.prepend(btn);
  }
  $id('startCity')?.addEventListener('change', updateDateNote);

  // ---------- start ----------
  // The shared-plan importer strips ?plan= from the URL before this script runs, so the flag is captured in <head>.
  const sharedPlan = window.MH_SHARED_PLAN || new URLSearchParams(location.search).has('plan');
  if (sharedPlan) {
    // Shared plans open straight into the planner.
    hideOverlay();
  } else {
    // Deep links from the show pages: /?city=london&show=hamilton#/plan adds the show to the shortlist
    // and opens the planner for that city.
    const params = new URLSearchParams(location.search);
    const linkCity = params.get('city');
    if (CITIES.includes(linkCity)) {
      hs.city = linkCity;
      const linkShow = params.get('show');
      if (linkShow && byId(linkCity, linkShow) && !hs.short[linkCity].includes(linkShow)) hs.short[linkCity].push(linkShow);
      persist();
      setPlannerCity(linkCity);
      history.replaceState(null, '', location.pathname + (location.hash || '#/plan'));
    }
    if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/start');
    route();
  }
})();
