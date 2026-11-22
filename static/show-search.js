// "Find a show by name" box (Yuval, 22 Nov 2026). One script for the planner's opening screen and
// for the top of every site page.
//   <div data-show-search></div>            -> the box is put there when the page loads
//   window.mtpShowSearch.mount(element)     -> for parts of a page that are drawn later
// Every show in the guide (data/shows-*.json) can be found: musicals, plays, spectaculars and family
// shows, in both cities. A result is a plain link to the show's own page (times and ticket buttons).
// The list of shows comes from window.SHOW_GUIDE when the page carries it (the planner), otherwise
// from /show-index.json, which build-show-index.mjs writes; it is fetched the first time the box is used.
// Searches are counted without anything personal (static/events.js): `show_search` with the title of
// the show that was opened, `show_search_none` with the text that found nothing.
(function () {
  if (window.mtpShowSearch) return;
  var CITY = { london: { slug: 'london', label: 'London' }, broadway: { slug: 'new-york', label: 'New York' } };
  var KIND = { play: 'Play', spectacular: 'Spectacular', family: 'Family show' };
  var MAX = 8;
  var uid = 0;

  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // "Les Misérables" -> "les miserables"; "& Juliet" -> "and juliet"; "Singin’ in the Rain" -> "singin in the rain"
  var words = function (v) {
    return String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ')
      .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  };
  var squash = function (v) { return words(v).replace(/ /g, ''); };
  var today = function () { return new Date().toISOString().slice(0, 10); };

  // ---------- the list of shows ----------
  function fromGuide(guide) {
    var out = [];
    Object.keys(CITY).forEach(function (city) {
      ((guide[city] || {}).shows || []).forEach(function (g) {
        if (!g || !g.id || !g.title) return;
        out.push({ city: city, id: g.id, title: g.title, match: g.match || [], venue: g.venue || '', kind: g.kind || 'musical',
          off: g.offBroadway ? 'Off-Broadway' : g.offWestEnd ? 'Off-West End' : '', upcoming: g.status === 'upcoming',
          until: g.bookingUntil || '', limited: !!g.limitedRun, closed: !!g.closed, familiar: !!g.familiar });
      });
    });
    return out;
  }
  function prepare(list) {
    var t = today();
    list.forEach(function (s) {
      s.w = words(s.title);
      s.sq = squash(s.title);
      s.noThe = s.w.replace(/^the /, '');
      s.keys = (s.match || []).map(function (m) { return String(m).toLowerCase(); });
      s.ended = s.closed || !!(s.until && s.until < t);
      s.href = CITY[s.city] ? '/' + CITY[s.city].slug + '/' + s.id + '/' : '';
    });
    return list;
  }
  var loading = null;
  function shows() {
    if (!loading) {
      loading = window.SHOW_GUIDE
        ? Promise.resolve(prepare(fromGuide(window.SHOW_GUIDE)))
        : fetch('/show-index.json', { credentials: 'omit' }).then(function (r) {
            if (!r.ok) throw new Error('show index ' + r.status);
            return r.json();
          }).then(function (d) { return prepare(fromGuide(d)); });
      loading.catch(function () { loading = null; }); // try again on the next keystroke
    }
    return loading;
  }

  // ---------- matching ----------
  // Small edit distance, for slips such as "hamiltn" or "wickd". Stops counting above `max`.
  function distance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i], best = cur[0];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
        if (cur[j] < best) best = cur[j];
      }
      if (best > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }
  // Lower is better; -1 = no match.
  function score(s, q, qsq, tokens) {
    if (s.w === q || s.noThe === q || s.sq === qsq) return 0;
    if (s.w.indexOf(q) === 0 || s.noThe.indexOf(q) === 0) return 1;
    var tw = s.w.split(' ');
    var allPrefix = tokens.every(function (t) { return tw.some(function (w) { return w.indexOf(t) === 0; }); });
    if (allPrefix) return 2;
    // Typed without the spaces, or running over two words ("lesmis", "les mis"): from the start of a
    // word, so that "lion" does not find "Million Dollar Quartet".
    if (qsq.length >= 3) {
      var at = 0;
      for (var i = 0; i < tw.length; i++) { if (s.sq.indexOf(qsq, at) === at) return 3; at += tw[i].length; }
      if (s.keys.some(function (k) { return k.indexOf(qsq) === 0; })) return 4; // other names the guide knows the show by
    }
    return -1;
  }
  function fuzzy(s, tokens) {
    var tw = s.w.split(' ');
    return tokens.every(function (t) {
      if (t.length < 4) return tw.indexOf(t) >= 0;
      var max = t.length >= 8 ? 2 : 1;
      // Same first letter, and close to the whole word ("hamiltn", "wickd") or, for a longer slip, to the
      // start of a word that is still being typed. Kept strict: "cats" must not find "The Great Gatsby".
      return tw.some(function (w) {
        if (w.charAt(0) !== t.charAt(0)) return false;
        return distance(t, w, max) <= max || (t.length >= 7 && w.length > t.length && distance(t, w.slice(0, t.length), max) <= max);
      });
    });
  }
  function search(list, text, homeCity) {
    var q = words(text), qsq = q.replace(/ /g, '');
    if (qsq.length < 2) return [];
    var tokens = q.split(' ');
    var hits = [];
    list.forEach(function (s) { var sc = score(s, q, qsq, tokens); if (sc >= 0) hits.push([sc, s]); });
    if (!hits.length && qsq.length >= 5) list.forEach(function (s) { if (fuzzy(s, tokens)) hits.push([5, s]); });
    hits.sort(function (a, b) {
      return (a[1].ended - b[1].ended) || (a[0] - b[0]) || ((b[1].city === homeCity) - (a[1].city === homeCity)) ||
        (b[1].familiar - a[1].familiar) || a[1].title.localeCompare(b[1].title) || a[1].city.localeCompare(b[1].city);
    });
    return hits.slice(0, MAX).map(function (h) { return h[1]; });
  }

  // ---------- the box ----------
  var CSS = '.ss{position:relative;text-align:left;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.ss-label{display:block;font-weight:700;font-size:15px;margin:0 0 6px}' +
    '.ss-field{position:relative}' +
    '.ss-field svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none;color:#6b665f}' +
    '.ss-input{display:block;width:100%;box-sizing:border-box;min-height:48px;padding:10px 14px 10px 42px;border-radius:12px;border:1px solid #cfc7ba;background:#fff;color:#181818;font:inherit;font-size:16px;-webkit-appearance:none;appearance:none}' +
    '.ss-input::-webkit-search-cancel-button{cursor:pointer}' +
    '.ss-input:focus-visible{outline:3px solid #d6a860;outline-offset:1px;border-color:#1f4b3f}' +
    '.ss-panel{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:80;background:#fffdf8;color:#181818;border:1px solid #ddd6ca;border-radius:14px;box-shadow:0 18px 44px rgba(23,19,15,.28);max-height:min(60vh,430px);overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px}' +
    '.ss-panel[hidden]{display:none}' +
    '.ss-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:52px;padding:8px 12px;border-radius:10px;text-decoration:none;color:#181818}' +
    '.ss-opt:hover,.ss-opt.ss-on,.ss-opt:focus-visible{background:#f1ebe0;outline:none}' +
    '.ss-opt.ss-on{box-shadow:inset 0 0 0 2px #1f4b3f}' +
    '.ss-name{display:block;font-weight:700;font-size:16px;line-height:1.25}' +
    '.ss-sub{display:block;font-size:13px;color:#6b665f;margin-top:2px}' +
    '.ss-tags{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0}' +
    '.ss-tag{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap;background:#e7efec;color:#1f4b3f}' +
    '.ss-tag.ss-ny{background:#fbf0e9;color:#7c2d12}.ss-tag.ss-kind{background:#eee8df;color:#4a453e;font-weight:600}' +
    '.ss-opt.ss-ended .ss-name{color:#6b665f}' +
    '.ss-msg{padding:12px;font-size:15px;line-height:1.45;color:#181818}.ss-msg a{color:#7c2d12;font-weight:600}' +
    '.ss-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}';
  function addStyle() {
    if (document.getElementById('show-search-style')) return;
    var st = document.createElement('style');
    st.id = 'show-search-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  var track = function (event, show) { try { if (window.mtpTrack) window.mtpTrack(event, { show: show }); } catch (e) {} };

  function mount(el) {
    if (!el || el.dataset.ssReady === '1') return;
    el.dataset.ssReady = '1';
    addStyle();
    var n = ++uid;
    var labelText = el.dataset.label || '';
    el.classList.add('ss');
    el.innerHTML = (labelText ? '<label class="ss-label" for="ssInput' + n + '">' + esc(labelText) + '</label>' : '') +
      '<div class="ss-field"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
      '<input class="ss-input" id="ssInput' + n + '" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ssPanel' + n + '"' +
      (labelText ? '' : ' aria-label="Find a show by name"') + ' placeholder="' + esc(el.dataset.placeholder || 'Find a show by name…') + '" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="60"></div>' +
      '<div class="ss-panel" id="ssPanel' + n + '" role="listbox" aria-label="Shows" hidden></div><div class="ss-sr" role="status" aria-live="polite"></div>';
    var input = el.querySelector('.ss-input'), panel = el.querySelector('.ss-panel'), status = el.querySelector('.ss-sr');
    var results = [], active = -1, lastNone = '', noneTimer = 0, seq = 0;

    function homeCity() {
      var c = el.dataset.city || '';
      if (!c) { var m = location.pathname.match(/^\/(london|new-york)\b/); c = m ? (m[1] === 'new-york' ? 'broadway' : 'london') : ''; }
      return c === 'new-york' ? 'broadway' : c;
    }
    function close() { panel.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function setActive(i) {
      var opts = panel.querySelectorAll('.ss-opt');
      active = opts.length ? (i + opts.length) % opts.length : -1;
      for (var k = 0; k < opts.length; k++) { opts[k].classList.toggle('ss-on', k === active); opts[k].setAttribute('aria-selected', k === active ? 'true' : 'false'); }
      if (active >= 0) { input.setAttribute('aria-activedescendant', opts[active].id); opts[active].scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function draw(text) {
      clearTimeout(noneTimer);
      if (!results.length) {
        panel.innerHTML = '<div class="ss-msg">No show called “' + esc(text.trim()) + '” in our guide. Check the spelling, or browse ' +
          '<a href="/london/">all West End shows</a> or <a href="/new-york/">all Broadway shows</a>.</div>';
        status.textContent = 'No shows found';
        // Counted once the visitor has stopped typing, so half-typed names are not stored.
        var said = words(text).slice(0, 40);
        if (said.length >= 3 && said !== lastNone) noneTimer = setTimeout(function () { lastNone = said; track('show_search_none', said); }, 1500);
      } else {
        panel.innerHTML = results.map(function (s, i) {
          var sub = [s.venue, s.ended ? (s.closed || s.limited ? 'Run has ended' : 'Check dates') : s.upcoming ? 'Coming soon' : ''].filter(Boolean).join(' · ');
          return '<a class="ss-opt' + (s.ended ? ' ss-ended' : '') + '" role="option" aria-selected="false" id="ssOpt' + n + '_' + i + '" href="' + esc(s.href) + '" data-i="' + i + '">' +
            '<span><span class="ss-name" translate="no">' + esc(s.title) + '</span>' + (sub ? '<span class="ss-sub">' + esc(sub) + '</span>' : '') + '</span>' +
            '<span class="ss-tags"><span class="ss-tag' + (s.city === 'broadway' ? ' ss-ny' : '') + '">' + CITY[s.city].label + '</span>' +
            (KIND[s.kind] || s.off ? '<span class="ss-tag ss-kind">' + esc(KIND[s.kind] || s.off) + '</span>' : '') + '</span></a>';
        }).join('');
        status.textContent = results.length + (results.length === 1 ? ' show found' : ' shows found');
      }
      panel.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    }
    function update() {
      var text = input.value, mine = ++seq;
      if (squash(text).length < 2) { clearTimeout(noneTimer); results = []; close(); status.textContent = ''; return; }
      shows().then(function (list) {
        if (mine !== seq) return;
        results = search(list, text, homeCity());
        draw(text);
      }, function () {
        if (mine !== seq) return;
        results = [];
        panel.innerHTML = '<div class="ss-msg">The list of shows could not be loaded. Browse <a href="/london/">West End shows</a> or <a href="/new-york/">Broadway shows</a> instead.</div>';
        panel.hidden = false;
      });
    }
    function open(i) {
      var s = results[i];
      if (!s) return;
      track('show_search', s.title);
      location.href = s.href;
    }
    input.addEventListener('input', update);
    input.addEventListener('focus', function () { shows().catch(function () {}); if (squash(input.value).length >= 2 && panel.hidden) update(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (panel.hidden) { update(); return; }
        e.preventDefault();
        setActive(active < 0 ? (e.key === 'ArrowDown' ? 0 : -1) : active + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter') {
        if (panel.hidden || !results.length) return;
        e.preventDefault();
        open(active >= 0 ? active : 0);
      } else if (e.key === 'Escape') {
        if (!panel.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
      }
    });
    // A tap on a result is an ordinary link; it is only counted here.
    panel.addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('.ss-opt') : null;
      if (a && results[Number(a.dataset.i)]) track('show_search', results[Number(a.dataset.i)].title);
    });
    document.addEventListener('pointerdown', function (e) { if (!el.contains(e.target)) close(); });
    el.addEventListener('focusout', function (e) { if (e.relatedTarget && !el.contains(e.relatedTarget)) close(); });
  }

  function mountAll() { var all = document.querySelectorAll('[data-show-search]'); for (var i = 0; i < all.length; i++) mount(all[i]); }
  // The same matching for another list (the planner's "Find a show" uses it for the shows of a trip):
  // items are { title, match: [squashed other names], ... }; the matching ones come back, best first.
  function find(items, text) {
    var list = prepare(items.map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; o.city = o.city || ''; o.id = o.id || ''; return o; }));
    var q = words(text), qsq = q.replace(/ /g, '');
    if (qsq.length < 2) return [];
    var tokens = q.split(' '), hits = [];
    list.forEach(function (s) { var sc = score(s, q, qsq, tokens); if (sc >= 0) hits.push([sc, s]); });
    if (!hits.length && qsq.length >= 5) list.forEach(function (s) { if (fuzzy(s, tokens)) hits.push([5, s]); });
    hits.sort(function (a, b) { return (a[0] - b[0]) || ((b[1].familiar ? 1 : 0) - (a[1].familiar ? 1 : 0)) || a[1].title.localeCompare(b[1].title); });
    return hits.map(function (h) { return h[1]; });
  }
  window.mtpShowSearch = { mount: mount, mountAll: mountAll, find: find, _search: function (text, city) { return shows().then(function (l) { return search(l, text, city || ''); }); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll); else mountAll();
})();
