import fs from 'node:fs';

const file = 'index.html';
const oldToken = '8da7d076-99e4-4478-a48d-12afafaaea5a';
const newToken = '78f630d5-38a1-405a-ae8c-7c79dba75f93';

let html = fs.readFileSync(file, 'utf8');
html = html.split(oldToken).join(newToken);
fs.writeFileSync(file, html);
console.log('Updated Impact verification token.');
