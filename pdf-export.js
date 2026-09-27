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

  function buildPdf(rows) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const range = typeof tripRangeText === 'function' ? tripRangeText() : `${fmt(state.start)} - ${fmt(state.end)}`;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('Musical Trip Schedule', 40, 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(clean(`${cityLabel()}  |  ${range}`), 40, 64);

    const hasTickets = rows.some(r => r.bookingReference || r.seat || r.ticketMatch);
    const head = ['Date', 'Session', 'Time', 'Musical', 'Theatre / Venue', 'Address'];
    if (hasTickets) head.push('Booking ref.', 'Seat', 'Ticket PDF check');
    const body = rows.map(r => {
      const line = [r.date, r.session, r.time, r.musical, r.venue || '', r.address || ''];
      if (hasTickets) line.push(r.bookingReference || '', r.seat || '', r.ticketMatch || '');
      return line.map(clean);
    });
    doc.autoTable({
      head: [head], body, startY: 80, margin: { left: 40, right: 40 },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 5, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: [31, 75, 63], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 241, 231] }
    });
    const y = Math.min((doc.lastAutoTable?.finalY || 80) + 20, doc.internal.pageSize.getHeight() - 30);
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(doc.splitTextToSize('Made with musicaltripplanner.com. Ticket purchases are handled solely by third-party providers. Verify show, date, time and venue with your ticket provider before travelling.', doc.internal.pageSize.getWidth() - 80), 40, y);
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
  async function deliver(doc) {
    const blob = doc.output('blob');
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

  async function exportPdfFile() {
    const rows = selectedRows();
    if (!rows.length) return alert('There are no selected performances to export.');
    try {
      // If the library is already loaded, build and share synchronously so the
      // browser still treats this as part of the tap (needed for the share sheet).
      if (!libsReady()) { setBusy(true); await loadLibs(); }
      await deliver(buildPdf(rows));
    } catch (e) {
      console.error('PDF export failed, falling back to print view', e);
      if (printFallback) printFallback();
    } finally {
      setBusy(false);
    }
  }

  exportPdf = exportPdfFile;
  const pdfBtn = document.getElementById('pdfBtn');
  if (pdfBtn) pdfBtn.onclick = exportPdfFile;
  // Warm the library up when the user starts finishing, so the PDF tap is instant.
  document.getElementById('finishBtn')?.addEventListener('click', () => { loadLibs().catch(() => {}); });
  // The export panel text still mentions the print dialog; update it.
  document.querySelectorAll('#exportPanel .small').forEach(p => {
    if (/print dialog/i.test(p.textContent)) p.textContent = 'PDF downloads as a file (on phones you can save or share it).';
  });
})();
