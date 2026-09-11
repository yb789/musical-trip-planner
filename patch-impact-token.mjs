import fs from 'node:fs';

const file = 'index.html';
const oldToken = '78f630d5-38a1-405a-ae8c-7c79dba75f93';
const newToken = 'e6edeba2-152a-4ba3-8ff8-f08e41725695';

let html = fs.readFileSync(file, 'utf8');
html = html.split(oldToken).join(newToken);
fs.writeFileSync(file, html);
console.log('Updated Impact verification token.');
