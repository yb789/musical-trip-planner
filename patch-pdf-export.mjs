import fs from 'node:fs';

// Replaces the print-dialog PDF export with a real PDF file (see pdf-export.js). Must run after
// patch-ticket-confirmation.mjs, which defines the export columns this reuses.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const js = fs.readFileSync('pdf-export.js', 'utf8');
s = s.replace(/\s*<script id=["']pdf-export-script["'][\s\S]*?<\/script>\s*/gi, '\n');
s = s.replace('</body>', `<script id="pdf-export-script">\n${js}\n</script>\n</body>`);
fs.writeFileSync(file, s);
console.log('PDF file export inlined into index.html.');
