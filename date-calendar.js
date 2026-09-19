(() => {
  // This enhancement runs after the original planner script and overrides only
  // date-selection/range behavior. Existing show selection, ticket links,
  // calendar addresses, exports and duplicate-show handling remain intact.

  state.segments = [];

  const dateOverlay = $('dateOverlay');
  dateOverlay.innerHTML = `
    <div class="modal date-picker-modal">
      <h2>Choose your city and trip dates</h2>
      <div id="savedNotice" class="saved-notice hidden">
        <div id="savedNoticeText"></div>
        <div class="actions">
          <button id="savedKeep" type="button">Keep them</button>
          <button id="savedClear" type="button" class="danger">Start fresh</button>
        </div>
      </div>
      <p class="small">Choose the city, then pick your trip dates on the calendar. Use the arrows to move between months.</p>
      <div class="field city-field">
        <label for="startCity">City</label>
        <select id="startCity">
          <option value="london">🇬🇧 London · West End</option>
          <option value="broadway">🗽 New York · Broadway</option>
        </select>
      </div>
      <div id="pickerHint" class="picker-hint" aria-live="polite"><span class="picker-step">1</span><span id="pickerHintText">Click your <b>start</b> date</span></div>
      <div class="range-picker-head">
        <button id="pickerPrev" type="button" aria-label="Previous month">←</button>
        <strong id="pickerMonthLabel"></strong>
        <button id="pickerNext" type="button" aria-label="Next month">→</button>
      </div>
      <div class="picker-weekdays">
        <span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>
      </div>
      <div id="pickerCalendar" class="picker-calendar"></div>
      <div id="rangeParts" class="range-parts"></div>
      <div id="dateCountNote" class="date-count-note"></div>
      <div id="dateError" class="error"></div>
      <div class="actions"><button id="continueBtn" class="primary">Continue to planner</button></div>
    </div>`;

  const warning = document.createElement('div');
  warning.id = 'longTripOverlay';
  warning.className = 'overlay warning-overlay hidden';
  warning.innerHTML = `
    <div class="modal">
      <h2>Long trip selected</h2>
      <p id="longTripText"></p>
      <p class="small">The planner can continue. To keep each live search manageable, it will automatically search the schedule in blocks of up to 21 days.</p>
      <div class="actions">
        <button id="longTripEdit" type="button">Go back and edit</button>
        <button id="longTripContinue" type="button" class="primary">Yes, continue</button>
      </div>
    </div>`;
  document.body.appendChild(warning);

  let picker = { month: null, activePart: 0, ranges: [{ start: '', end: '' }], split: false };
  let pendingPlan = null;

  function monthDate() {
    return picker.month || new Date(new Date().getFullYear(), new Date().getMonth(), 1, 12);
  }

  function setMonthFromISO(value) {
    const d = value ? parseISO(value) : new Date();
    picker.month = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  }

  function rangeLabel(range) {
    if (!range?.start) return 'Choose dates';
    if (!range.end) return `${fmt(range.start, { day: 'numeric', month: 'short', year: 'numeric' })} → choose end date`;
    return `${fmt(range.start, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmt(range.end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  function datesForRanges(ranges) {
    const result = new Set();
    for (const range of ranges || []) {
      if (!range?.start || !range?.end) continue;
      let d = range.start;
      let guard = 0;
      while (d <= range.end && guard++ < 3660) {
        result.add(d);
        d = addDays(d, 1);
      }
    }
    return [...result].sort();
  }

  function pickerDayCount() {
    return datesForRanges(picker.ranges).length;
  }

  function inRange(date, range) {
    return !!(range?.start && range?.end && date >= range.start && date <= range.end);
  }

  function renderPicker() {
    const current = monthDate();
    const y = current.getFullYear();
    const m = current.getMonth();
    $('pickerMonthLabel').textContent = current.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    const grid = $('pickerCalendar');
    grid.innerHTML = '';
    const first = (new Date(y, m, 1, 12).getDay() + 6) % 7;
    const total = new Date(y, m + 1, 0, 12).getDate();

    for (let i = 0; i < first; i++) {
      const blank = document.createElement('div');
      blank.className = 'picker-blank';
      grid.appendChild(blank);
    }

    for (let n = 1; n <= total; n++) {
      const date = iso(new Date(y, m, n, 12));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'picker-day';
      button.textContent = n;
      button.title = fmt(date);

      const active = picker.ranges[picker.activePart] || {};
      if (inRange(date, active)) button.classList.add('in-range');
      if (date === active.start) button.classList.add('range-start');
      if (date === active.end) button.classList.add('range-end');
      if (picker.ranges.some((r, i) => i !== picker.activePart && inRange(date, r))) button.classList.add('other-range');

      button.onclick = () => chooseDate(date);
      grid.appendChild(button);
    }

    $('rangeParts').innerHTML = picker.ranges.map((range, i) => `
      <button type="button" class="range-part ${i === picker.activePart ? 'active' : ''}" data-part="${i}">
        <b>${picker.ranges.length > 1 ? `Trip part ${i + 1}` : 'Trip dates'}</b>
        <span>${rangeLabel(range)}</span>
      </button>`).join('');

    document.querySelectorAll('.range-part').forEach(button => {
      button.onclick = () => {
        picker.activePart = Number(button.dataset.part);
        const range = picker.ranges[picker.activePart];
        if (range?.start) setMonthFromISO(range.start);
        renderPicker();
      };
    });

    const count = pickerDayCount();
    const note = $('dateCountNote');
    if (count > 21) {
      note.className = 'date-count-note warning';
      note.innerHTML = `You selected <b>${count} days</b>. That is more than 21 days. You can continue after confirming.`;
    } else if (count) {
      note.className = 'date-count-note note';
      note.textContent = `${count} day${count === 1 ? '' : 's'} selected.`;
    } else {
      note.className = 'date-count-note';
      note.textContent = '';
    }

    const active = picker.ranges[picker.activePart] || {};
    const hint = $('pickerHint');
    const short = d => fmt(d, { day: 'numeric', month: 'short' });
    if (!active.start) {
      hint.className = 'picker-hint step-start';
      hint.innerHTML = '<span class="picker-step">1</span><span id="pickerHintText">Click your <b>start</b> date</span>';
    } else if (!active.end) {
      hint.className = 'picker-hint step-end';
      hint.innerHTML = `<span class="picker-step">2</span><span id="pickerHintText">Now click your <b>end</b> date <small>(start: ${short(active.start)})</small></span>`;
    } else {
      hint.className = 'picker-hint step-done';
      hint.innerHTML = `<span class="picker-step">✓</span><span id="pickerHintText"><b>${short(active.start)} – ${short(active.end)}</b> selected — press Continue, or click a date to start over</span>`;
    }
  }

  function chooseDate(date) {
    const range = picker.ranges[picker.activePart] || { start: '', end: '' };
    if (!range.start || range.end) {
      range.start = date;
      range.end = '';
    } else if (date < range.start) {
      range.end = range.start;
      range.start = date;
    } else {
      range.end = date;
    }
    picker.ranges[picker.activePart] = range;
    renderPicker();
  }

  function normalizedRanges() {
    return picker.ranges
      .filter(r => r?.start && r?.end)
      .map(r => ({ start: r.start, end: r.end }))
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  function validatePlan() {
    const city = $('startCity').value;
    if (!['london', 'broadway'].includes(city)) return { error: 'Please choose London or New York.' };
    const expected = picker.split ? 2 : 1;
    const ranges = normalizedRanges();
    if (ranges.length !== expected) {
      return { error: `Please choose both a start and end date for ${picker.split ? 'each trip part' : 'the trip'}.` };
    }
    if (ranges.length === 2 && ranges[1].start <= ranges[0].end) {
      return { error: 'The two trip parts overlap. Please choose two separate date ranges.' };
    }
    return { city, ranges, count: datesForRanges(ranges).length };
  }

  function currentSegments() {
    if (Array.isArray(state.segments) && state.segments.length) {
      return state.segments.filter(r => r?.start && r?.end).slice().sort((a, b) => a.start.localeCompare(b.start));
    }
    return state.start && state.end ? [{ start: state.start, end: state.end }] : [];
  }

  window.tripSegments = currentSegments;
  window.isTripDate = date => currentSegments().some(r => date >= r.start && date <= r.end);

  days = function () {
    return datesForRanges(currentSegments());
  };

  window.selectedDayCount = () => days().length;

  window.tripRangeText = function () {
    const ranges = currentSegments();
    if (!ranges.length) return 'Trip dates';
    const short = d => fmt(d, { day: 'numeric', month: 'short', year: 'numeric' });
    if (ranges.length === 1) return `${short(ranges[0].start)} – ${short(ranges[0].end)}`;
    return ranges.map((r, i) => `Part ${i + 1}: ${short(r.start)} – ${short(r.end)}`).join(' · ');
  };

  renderRange = function () {
    $('rangeLabel').textContent = `${cityLabel()} · ${tripRangeText()}`;
  };

  function searchChunks() {
    const chunks = [];
    for (const range of currentSegments()) {
      let start = range.start;
      while (start <= range.end) {
        const candidate = addDays(start, 20);
        const end = candidate > range.end ? range.end : candidate;
        chunks.push({ start, end });
        start = addDays(end, 1);
      }
    }
    return chunks;
  }

  loadSchedule = async function () {
    const chunks = searchChunks();
    const count = selectedDayCount();
    setLoading(true, `Searching ${cityLabel()} for ${count} selected day${count === 1 ? '' : 's'}…`);
    setStatus('Searching live theatre schedules…');

    try {
      const showsByName = new Map();
      const schedule = {};
      const sources = new Set();
      let performanceCount = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        $('loadingText').textContent = `Searching ${cityLabel()} · ${fmt(chunk.start, { day: 'numeric', month: 'short' })} – ${fmt(chunk.end, { day: 'numeric', month: 'short', year: 'numeric' })}${chunks.length > 1 ? ` · block ${i + 1} of ${chunks.length}` : ''}…`;
        const response = await fetch(`/api/schedule?city=${encodeURIComponent(state.city)}&start=${chunk.start}&end=${chunk.end}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `Schedule service returned ${response.status}`);
        if (!Array.isArray(data.shows) || !data.schedule) throw new Error('Incomplete schedule data');

        for (const show of data.shows) {
          const displayName = typeof cleanShowTitle === 'function' ? cleanShowTitle(show.name) : String(show.name || '');
          const key = displayName.toLowerCase();
          if (key) showsByName.set(key, { ...(showsByName.get(key) || {}), ...show, name: displayName });
        }

        for (const [date, entries] of Object.entries(data.schedule || {})) {
          if (!isTripDate(date)) continue;
          if (!schedule[date]) schedule[date] = [];
          const seen = new Set(schedule[date].map(([name, time]) => `${String(name).toLowerCase()}|${time}`));
          for (const item of Array.isArray(entries) ? entries : []) {
            let [name, time] = item || [];
            if (typeof cleanShowTitle === 'function') name = cleanShowTitle(name);
            const key = `${String(name || '').toLowerCase()}|${time}`;
            if (name && time && !seen.has(key)) {
              seen.add(key);
              schedule[date].push([name, time]);
              performanceCount++;
            }
          }
        }
        for (const source of data.sources || []) sources.add(source);
      }

      for (const date of days()) if (!schedule[date]) schedule[date] = [];
      state.data[state.city] = { shows: [...showsByName.values()], schedule };
      setStatus(`Live schedule refreshed: ${showsByName.size} musicals and ${performanceCount} performance slots found across ${count} selected day${count === 1 ? '' : 's'}. ${[...sources].join(' + ')}`, 'ok');
      renderAll();
    } catch (error) {
      console.error(error);
      setStatus(`Live search failed: ${error.message}`, 'error');
      renderAll();
    } finally {
      setLoading(false);
    }
  };

  renderCalendar = function () {
    $('calendar').innerHTML = '';
    if (!state.start || !state.end) return;
    let cur = new Date(parseISO(state.start).getFullYear(), parseISO(state.start).getMonth(), 1, 12);
    const end = parseISO(state.end);

    while (cur <= end) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const section = document.createElement('section');
      section.className = 'month';
      section.innerHTML = `<div class="month-title">${cur.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })} · ${esc(cityLabel())}</div><div class="weekdays">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(x => `<div>${x}</div>`).join('')}</div><div class="month-grid"></div>`;
      const grid = section.querySelector('.month-grid');
      const first = (new Date(y, m, 1, 12).getDay() + 6) % 7;
      const total = new Date(y, m + 1, 0, 12).getDate();
      for (let i = 0; i < first; i++) grid.innerHTML += '<div class="day-cell out"></div>';

      for (let n = 1; n <= total; n++) {
        const date = iso(new Date(y, m, n, 12));
        const inside = isTripDate(date);
        const cell = document.createElement('div');
        cell.className = `day-cell ${inside ? 'inrange' : 'out'}${date === state.active ? ' active' : ''}`;
        cell.innerHTML = `<b>${n}<span class="day-wd">${new Date(y, m, n, 12).toLocaleDateString('en-GB', { weekday: 'short' })}</span></b>`;
        if (inside) {
          const choice = choices()[date] || {};
          cell.innerHTML += calendarChoiceHtml('☀️', choice.matinee) + calendarChoiceHtml('🌙', choice.evening);
          cell.onclick = () => {
            state.active = date;
            showTab('schedule');
            renderDays();
            renderSidebar();
            renderDay();
            renderCalendar();
          };
        }
        grid.appendChild(cell);
      }
      $('calendar').appendChild(section);
      cur = new Date(y, m + 1, 1, 12);
    }
  };

  selectedRows = function () {
    const rows = [];
    for (const date of Object.keys(choices()).sort()) {
      if (!isTripDate(date)) continue;
      for (const session of ['matinee', 'evening']) {
        const choice = choices()[date]?.[session];
        if (!choice) continue;
        const loc = typeof resolveVenueAndAddress === 'function'
          ? resolveVenueAndAddress(choice)
          : { meta: showMeta(choice.name) || {}, venue: choice.venue || '', address: choice.address || '' };
        rows.push({
          city: cityLabel(),
          date: fmt(date),
          session: session === 'matinee' ? 'Matinee / Afternoon' : 'Evening',
          time: choice.time,
          musical: typeof cleanShowTitle === 'function' ? cleanShowTitle(choice.name) : choice.name,
          venue: loc.venue,
          address: loc.address,
          ticket: choice.ticketUrl || loc.meta?.ticketUrl || '',
          theatre: choice.venueUrl || choice.infoUrl || loc.meta?.venueUrl || loc.meta?.infoUrl || ''
        });
      }
    }
    return rows;
  };

  const originalExportPdf = exportPdf;
  exportPdf = function () {
    return originalExportPdf();
  };

  async function applyPlan(plan) {
    const oldActive = state.active;
    state.city = plan.city;
    state.segments = plan.ranges.map(r => ({ ...r }));
    state.start = state.segments[0].start;
    state.end = state.segments[state.segments.length - 1].end;
    state.active = oldActive && isTripDate(oldActive) ? oldActive : state.segments[0].start;
    $('dateOverlay').classList.add('hidden');
    $('longTripOverlay').classList.add('hidden');
    renderCities();
    renderRange();
    save();
    await loadSchedule();
  }

  startPlanning = async function () {
    $('dateError').textContent = '';
    const plan = validatePlan();
    if (plan.error) {
      $('dateError').textContent = plan.error;
      return;
    }
    if (plan.count > 21) {
      pendingPlan = plan;
      $('longTripText').innerHTML = `You selected <b>${plan.count} days</b>, which is more than 21. Are you sure you want to search this entire selection?`;
      $('longTripOverlay').classList.remove('hidden');
      return;
    }
    await applyPlan(plan);
  };

  function openPickerFromState() {
    $('startCity').value = state.city;
    const ranges = currentSegments();
    // Split trips are no longer offered (removed 2026-09-19): an older two-part trip reopens as one continuous range.
    picker.ranges = ranges.length ? [{ start: ranges[0].start, end: ranges[ranges.length - 1].end }] : [{ start: '', end: '' }];
    picker.split = false;
    picker.activePart = 0;
    setMonthFromISO(picker.ranges[0]?.start || iso(new Date()));
    $('dateError').textContent = '';
    renderPicker();
    $('dateOverlay').classList.remove('hidden');
  }

  $('continueBtn').onclick = startPlanning;
  $('changeDatesBtn').onclick = openPickerFromState;
  $('pickerPrev').onclick = () => {
    const m = monthDate();
    picker.month = new Date(m.getFullYear(), m.getMonth() - 1, 1, 12);
    renderPicker();
  };
  $('pickerNext').onclick = () => {
    const m = monthDate();
    picker.month = new Date(m.getFullYear(), m.getMonth() + 1, 1, 12);
    renderPicker();
  };
  $('longTripEdit').onclick = () => {
    $('longTripOverlay').classList.add('hidden');
    pendingPlan = null;
  };
  $('longTripContinue').onclick = async () => {
    const plan = pendingPlan;
    pendingPlan = null;
    if (plan) await applyPlan(plan);
  };

  // Startup notice: selections saved by a previous visit can be kept or wiped before planning.
  function showSavedNotice() {
    if (typeof savedSelectionSummary !== 'function') return;
    const { shows, hidden } = savedSelectionSummary();
    if (!shows && !hidden) return;
    const parts = [];
    if (shows) parts.push(`<b>${shows} chosen performance${shows === 1 ? '' : 's'}</b>`);
    if (hidden) parts.push(`<b>${hidden} unticked musical${hidden === 1 ? '' : 's'}</b>`);
    $('savedNoticeText').innerHTML = `This browser still has ${parts.join(' and ')} from a previous visit. Keep them, or start fresh?`;
    $('savedNotice').classList.remove('hidden', 'cleared');
    $('savedKeep').classList.remove('hidden');
    $('savedClear').classList.remove('hidden');
  }
  $('savedKeep').onclick = () => $('savedNotice').classList.add('hidden');
  $('savedClear').onclick = () => {
    clearAllSelections();
    $('savedNoticeText').textContent = 'Previous selections cleared. You are starting fresh.';
    $('savedNotice').classList.add('cleared');
    $('savedKeep').classList.add('hidden');
    $('savedClear').classList.add('hidden');
  };

  $('startCity').value = state.city;
  setMonthFromISO(iso(new Date()));
  renderPicker();
  renderCities();
  showSavedNotice();
})();
