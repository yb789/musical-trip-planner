// PDF export that produces a real .pdf file instead of relying on window.print().
// window.print() does nothing in many mobile and in-app browsers (WhatsApp, Gmail, Instagram...),
// so the schedule is drawn with jsPDF, then shared (phones) or downloaded (desktop).
// Falls back to the old print view if the library cannot be loaded.
(() => {
  const LIBS = [
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js'
  ];
  const printFallback = typeof exportPdf === 'function' ? exportPdf : null;
  let libPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  function loadLibs() {
    if (window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve();
    if (!libPromise) {
      libPromise = LIBS.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
        .catch(e => { libPromise = null; throw e; });
    }
    return libPromise;
  }
  const libsReady = () => !!window.jspdf?.jsPDF?.API?.autoTable;

  // jsPDF's built-in fonts only cover Latin-1 plus a few typographic characters.
  const clean = v => String(v ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/·/g, '-').replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ]/g, '');

  // Phones (narrow screens) get a portrait page with merged columns; computers keep landscape.
  function wantPortrait() {
    return Math.min(window.innerWidth || 9999, (window.screen && window.screen.width) || 9999) < 760;
  }

  function buildPdf(rows, portrait = wantPortrait()) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: portrait ? 'portrait' : 'landscape', unit: 'pt', format: 'a4' });
    const range = typeof tripRangeText === 'function' ? tripRangeText() : `${fmt(state.start)} - ${fmt(state.end)}`;
    const left = portrait ? 32 : 40;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Musical Trip Schedule', left, 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(clean(`${cityLabel()}  |  ${range}`), left, 64);

    const hasTickets = rows.some(r => r.bookingReference || r.seat || r.ticketMatch);
    // Ticket link columns: clickable SeatPlan / Ticketmaster links per row (tracked affiliate links
    // from selectedRows()). A column is only added when at least one row has that link.
    const isUrl = v => /^https?:\/\//.test(v || '');
    const linkDefs = [
      { key: 'ticket', head: 'SeatPlan', label: portrait ? 'Book' : 'Tickets on SeatPlan' },
      { key: 'ticketmaster', head: 'Ticketmaster', label: portrait ? 'Book' : 'Tickets on Ticketmaster' }
    ].filter(d => rows.some(r => isUrl(r[d.key])));
    let head, body, kindCol, columnStyles = {};
    const linkCols = {};
    if (portrait) {
      // When | Show (+kind) | Theatre (+address) | link columns | Booking
      head = ['When', 'Show', 'Theatre / Venue'];
      kindCol = -1;
      for (const d of linkDefs) { linkCols[head.length] = d.key; head.push(d.head); }
      if (hasTickets) head.push('Booking');
      body = rows.map(r => {
        const kind = r.kind && r.kind !== 'Musical' ? `\n${r.kind}` : '';
        const shortDate = String(r.date || '').replace(/^(\w{3})\w*,/, '$1').replace(/ (\w{3})\w* (\d{4})$/, ' $1 $2');
        const line = [`${shortDate}\n${r.session} ${r.time}`, `${r.musical}${kind}`, [r.venue, r.address].filter(Boolean).join('\n')];
        for (const d of linkDefs) line.push(isUrl(r[d.key]) ? d.label : '');
        if (hasTickets) line.push([r.bookingReference && `Ref: ${r.bookingReference}`, r.seat && `Seat: ${r.seat}`, r.ticketMatch].filter(Boolean).join('\n'));
        return line.map(clean);
      });
      columnStyles = { 0: { cellWidth: 100 }, 1: { cellWidth: 120, fontStyle: 'bold' } };
      for (const i of Object.keys(linkCols)) columnStyles[i] = { cellWidth: 62 };
    } else {
      head = ['Date', 'Session', 'Time', 'Show', 'Kind', 'Theatre / Venue', 'Address'];
      kindCol = 4;
      for (const d of linkDefs) { linkCols[head.length] = d.key; head.push(d.head); }
      if (hasTickets) head.push('Booking ref.', 'Seat', 'Ticket PDF check');
      body = rows.map(r => {
        const line = [r.date, r.session, r.time, r.musical, r.kind || 'Musical', r.venue || '', r.address || ''];
        for (const d of linkDefs) line.push(isUrl(r[d.key]) ? d.label : '');
        if (hasTickets) line.push(r.bookingReference || '', r.seat || '', r.ticketMatch || '');
        return line.map(clean);
      });
    }
    for (const [i, key] of Object.entries(linkCols)) columnStyles[i] = { ...(columnStyles[i] || {}), textColor: key === 'ticketmaster' ? [2, 77, 223] : [124, 45, 18], fontStyle: 'bold' };
    const KIND_RGB = { Play: [79, 70, 160], Spectacular: [180, 86, 13], Concert: [15, 110, 120], 'Family show': [31, 122, 77] };
    doc.autoTable({
      head: [head], body, startY: 80, margin: { left, right: left },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: portrait ? 4 : 5, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [31, 75, 63], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 241, 231] },
      columnStyles,
      // Kind column coloured like the planner (play purple, spectacular amber, family green).
      didParseCell: data => {
        if (data.section !== 'body' || data.column.index !== kindCol) return;
        const col = KIND_RGB[String(data.cell.raw || '')];
        if (col) { data.cell.styles.textColor = col; data.cell.styles.fontStyle = 'bold'; }
      },
      didDrawCell: data => {
        if (data.section !== 'body') return;
        const key = linkCols[data.column.index];
        if (!key) return;
        const url = rows[data.row.index]?.[key];
        if (isUrl(url)) doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
      }
    });
    const y = Math.min((doc.lastAutoTable?.finalY || 80) + 20, doc.internal.pageSize.getHeight() - 30);
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize('Made with musicaltripplanner.com. Ticket purchases are handled solely by third-party providers. Verify show, date, time and venue with your ticket provider before travelling. Ticket links are affiliate links: we may earn a small commission if you book, at no extra cost to you.', doc.internal.pageSize.getWidth() - 2 * left), left, y);
    return doc;
  }

  function fileName() {
    return `musical-schedule-${state.city}-${state.start}-to-${state.end}.pdf`;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  function isTouch() {
    return window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  }
  async function deliver(blob) {
    const name = fileName();
    if (isTouch() && typeof File === 'function' && navigator.canShare) {
      const file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Musical trip schedule' }); return; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
    }
    download(blob, name);
  }

  function setBusy(on) {
    const b = document.getElementById('pdfBtn');
    if (!b) return;
    if (on) { b.dataset.label = b.textContent; b.textContent = 'Preparing PDF…'; b.disabled = true; }
    else { b.textContent = b.dataset.label || 'Export to PDF'; b.disabled = false; }
  }

  // ---- Preview before saving (2026-10-31, Yuval) ----
  // The PDF is drawn page by page with PDF.js (already used for ticket confirmations) into a pop-up;
  // "Save / share PDF" then downloads it (computer) or opens the share sheet (phone). If PDF.js
  // cannot load, the PDF itself is shown in a frame (desktop) or saved straight away.
  let preview = null; // {blob}
  function ensurePreview() {
    let o = document.getElementById('pdfPreviewOverlay');
    if (o) return o;
    o = document.createElement('div');
    o.id = 'pdfPreviewOverlay';
    o.className = 'overlay hidden';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'pdfPreviewTitle');
    o.innerHTML = `<div class="modal pdf-preview-modal"><div class="pdf-preview-head"><div><h2 id="pdfPreviewTitle">Your PDF</h2><div class="small" id="pdfPreviewInfo"></div></div><div class="pdf-preview-actions"><button type="button" id="pdfPreviewSave" class="primary">${isTouch() ? 'Save / share PDF' : 'Download PDF'}</button><button type="button" id="pdfPreviewClose">Close</button></div></div><div id="pdfPreviewPages" class="pdf-preview-pages"></div></div>`;
    document.body.appendChild(o);
    const st = document.createElement('style');
    st.textContent = `.pdf-preview-modal{width:min(1000px,100%);padding:16px}
.pdf-preview-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;position:sticky;top:-16px;background:var(--paper);padding:4px 0 10px;z-index:2}
.pdf-preview-head h2{margin:0}
.pdf-preview-actions{display:flex;gap:8px;flex-wrap:wrap}
.pdf-preview-actions button{min-height:44px}
.pdf-preview-pages{display:flex;flex-direction:column;align-items:center;gap:14px;background:#d9d4cc;border-radius:12px;padding:14px}
.pdf-preview-pages canvas,.pdf-preview-pages iframe{width:100%;height:auto;background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.18);border-radius:2px}
.pdf-preview-pages iframe{height:75vh;border:0}
.pdf-preview-pages .pdf-preview-msg{color:#333;font-size:14px;padding:24px}
@media (max-width:760px){.pdf-preview-modal{padding:12px}.pdf-preview-pages{padding:8px}.pdf-preview-actions{width:100%}.pdf-preview-actions button{flex:1}}`;
    document.head.appendChild(st);
    o.querySelector('#pdfPreviewClose').onclick = closePreview;
    o.addEventListener('click', e => { if (e.target === o) closePreview(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && preview) closePreview(); });
    // Saving runs straight from the tap, so phones still allow the share sheet.
    o.querySelector('#pdfPreviewSave').onclick = () => { if (preview) deliver(preview.blob); };
    return o;
  }
  function closePreview() {
    preview = null;
    const o = document.getElementById('pdfPreviewOverlay');
    if (!o) return;
    o.classList.add('hidden');
    const pages = o.querySelector('#pdfPreviewPages');
    pages.querySelectorAll('iframe').forEach(f => { try { URL.revokeObjectURL(f.src); } catch (_) {} });
    pages.innerHTML = '';
  }
  async function renderPages(blob, host) {
    if (typeof window.mhGetPdfJs !== 'function') throw new Error('PDF.js not available');
    const pdfjs = await window.mhGetPdfJs();
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    host.innerHTML = '';
    const width = Math.max(280, host.clientWidth - 28);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    for (let n = 1; n <= pdf.numPages; n++) {
      if (!preview) return; // closed meanwhile
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * ratio });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.setAttribute('aria-label', `Page ${n} of ${pdf.numPages}`);
      host.appendChild(c);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    }
    return pdf.numPages;
  }
  async function showPreview(doc, portrait, rows) {
    const blob = doc.output('blob');
    preview = { blob };
    const o = ensurePreview();
    const host = o.querySelector('#pdfPreviewPages');
    const info = o.querySelector('#pdfPreviewInfo');
    info.textContent = `${rows.length} performance${rows.length === 1 ? '' : 's'} · A4 ${portrait ? 'portrait' : 'landscape'} · nothing is saved until you press ${isTouch() ? 'Save / share' : 'Download'}.`;
    host.innerHTML = '<div class="pdf-preview-msg">Preparing the preview…</div>';
    o.classList.remove('hidden');
    o.querySelector('.modal').scrollTop = 0;
    try {
      const pages = await renderPages(blob, host);
      if (pages) info.textContent = info.textContent.replace(' · A4', ` · ${pages} page${pages === 1 ? '' : 's'} · A4`);
    } catch (e) {
      console.error('PDF preview failed', e);
      if (!preview) return;
      if (!isTouch()) {
        const f = document.createElement('iframe');
        f.title = 'PDF preview';
        f.src = URL.createObjectURL(blob);
        host.innerHTML = ''; host.appendChild(f);
      } else {
        host.innerHTML = '<div class="pdf-preview-msg">The preview could not be shown on this device, but your PDF is ready. Press <b>Save / share PDF</b>.</div>';
      }
    }
  }

  async function exportPdfFile() {
    const rows = selectedRows();
    if (!rows.length) return alert('There are no selected performances to export.');
    try {
      if (!libsReady()) { setBusy(true); await loadLibs(); }
      const portrait = wantPortrait();
      await showPreview(buildPdf(rows, portrait), portrait, rows);
    } catch (e) {
      console.error('PDF export failed, falling back to print view', e);
      if (printFallback) printFallback();
    } finally {
      setBusy(false);
    }
  }
  window.mhBuildPdf = buildPdf;

  exportPdf = exportPdfFile;
  const pdfBtn = document.getElementById('pdfBtn');
  if (pdfBtn) pdfBtn.onclick = exportPdfFile;
  // Warm the library up when the user starts finishing, so the PDF tap is instant.
  document.getElementById('finishBtn')?.addEventListener('click', () => { loadLibs().catch(() => {}); });
  // The export panel text still mentions the print dialog; update it.
  document.querySelectorAll('#exportPanel .small').forEach(p => {
    if (/print dialog/i.test(p.textContent)) p.textContent = 'Export to PDF shows a preview first; then download it (on phones: save or share it). Phones get a portrait page, computers landscape.';
  });
})();
