import fs from 'node:fs';

const file = 'index.html';
const tag = `<meta name='impact-site-verification' value='0a5183a9-64f8-440f-9453-61a053973f22'>`;
let html = fs.readFileSync(file, 'utf8');

if (!html.includes('impact-site-verification')) {
  html = html.replace('</head>', `${tag}\n</head>`);
  fs.writeFileSync(file, html);
  console.log('Added Impact website verification meta tag.');
} else {
  console.log('Impact website verification meta tag already present.');
}
