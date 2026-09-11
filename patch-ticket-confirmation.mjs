import fs from 'node:fs';

const file='index.html';
let s=fs.readFileSync(file,'utf8');
const css=fs.readFileSync('ticket-confirmation.css','utf8');
const js=fs.readFileSync('ticket-confirmation.js','utf8');

s=s.replace(/\s*<style id=["']ticket-confirmation-enhancement["'][\s\S]*?<\/style>\s*/gi,'\n');
s=s.replace(/\s*<script id=["']ticket-confirmation-enhancement-script["'][\s\S]*?<\/script>\s*/gi,'\n');

s=s.replace('</head>',`<style id="ticket-confirmation-enhancement">\n${css}\n</style>\n</head>`);
s=s.replace('</body>',`<script id="ticket-confirmation-enhancement-script">\n${js}\n</script>\n</body>`);

fs.writeFileSync(file,s);
console.log('Ticket confirmation PDF enhancement inlined into index.html.');
