// "Add to calendar": downloads an .ics file with every chosen performance of the trip.
// The builder (lib/ics.js) is inlined just above this script by patch-ics.mjs as window.mhIcs.
(function () {
  function rangeText() {
    try {
      const segs = typeof currentSegments === 'function' ? currentSegments() : [{ start: state.start, end: state.end }];
      const f = d => fmt(d, { day: 'numeric', month: 'short' });
      return segs.length === 1 ? (segs[0].start === segs[0].end ? f(segs[0].start) : f(segs[0].start) + ' – ' + f(segs[0].end)) : f(segs[0].start) + ' – ' + f(segs[segs.length - 1].end);
    } catch { return ''; }
  }
  function events() {
    const out = [];
    const all = choices();
    for (const date of Object.keys(all).sort()) {
      if (typeof isTripDate === 'function' ? !isTripDate(date) : (date < state.start || date > state.end)) continue;
      for (const sess of ['matinee', 'evening']) {
        const c = all[date][sess];
        if (!c || !c.time) continue;
        const loc = typeof resolveVenueAndAddress === 'function' ? resolveVenueAndAddress(c) : { meta: showMeta(c.name) || {}, venue: c.venue || '', address: c.address || '' };
        const g = typeof window.mhGuideEntry === 'function' ? window.mhGuideEntry(c.name) : null;
        const part = typeof partLabel === 'function' ? partLabel(c.name, c.time, date) : '';
        const url = (typeof officialTicketFor === 'function' && officialTicketFor(c)) || (typeof ticketLinkFor === 'function' ? ticketLinkFor(c) : c.ticketUrl) || c.ticketUrl || loc.meta?.ticketUrl || '';
        out.push({ date, time: c.time, name: typeof cleanShowTitle === 'function' ? cleanShowTitle(c.name) : c.name, part, venue: loc.venue, address: loc.address, url, minutes: window.mhIcs.runtimeMinutes(g && g.runtime, part) });
      }
    }
    return out;
  }
  window.exportIcs = function () {
    const evs = events();
    if (!evs.length) return alert('There are no selected performances to add to your calendar.');
    const city = state.city === 'london' ? 'London' : 'New York';
    const ics = window.mhIcs.buildIcs({ city: state.city, name: `${city} shows · ${rangeText()}`, events: evs });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `musical-trip-${state.city}-${state.start || 'plan'}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const btn = document.getElementById('icsBtn');
  if (btn) btn.onclick = window.exportIcs;
})();
