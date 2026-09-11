import fs from 'node:fs';

const file='index.html';
let s=fs.readFileSync(file,'utf8');
const css=fs.readFileSync('date-calendar.css','utf8');
const js=fs.readFileSync('date-calendar.js','utf8');

// Remove any older external references if they exist, then inline everything
// into the final HTML. This keeps Vercel's static output to a single file and
// avoids deployment failures caused by missing/copying auxiliary assets.
s=s.replace(/\s*<link[^>]+href=["']\/date-calendar\.css["'][^>]*>\s*/gi,'\n');
s=s.replace(/\s*<script[^>]+src=["']\/date-calendar\.js["'][^>]*><\/script>\s*/gi,'\n');
s=s.replace(/\s*<style id=["']date-calendar-enhancement["'][\s\S]*?<\/style>\s*/gi,'\n');
s=s.replace(/\s*<script id=["']date-calendar-enhancement-script["'][\s\S]*?<\/script>\s*/gi,'\n');

s=s.replace('</head>',`<style id="date-calendar-enhancement">\n${css}\n</style>\n</head>`);
s=s.replace('</body>',`<script id="date-calendar-enhancement-script">\n${js}\n</script>\n</body>`);

fs.writeFileSync(file,s);
console.log('Calendar date range enhancement inlined into index.html.');
