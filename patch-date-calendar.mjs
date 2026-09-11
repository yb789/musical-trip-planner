import fs from 'node:fs';
const file='index.html';
let s=fs.readFileSync(file,'utf8');
if(!s.includes('/date-calendar.css')) s=s.replace('</head>','<link rel="stylesheet" href="/date-calendar.css">\n</head>');
if(!s.includes('/date-calendar.js')) s=s.replace('</body>','<script src="/date-calendar.js"></script>\n</body>');
fs.writeFileSync(file,s);
console.log('Date calendar enhancement linked.');
