import fs from 'node:fs';

// Links to the About & contact page (/about/) from the planner: the crawlable intro,
// the opening screen's "Or explore first" row, and the ticket disclaimer.
// Runs after patch-show-helper.mjs, which writes the first two. Safe to run twice.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const about = '<a href="/about/">About us</a>';
const edits = [
  ['<a href="/guides/">Theatre trip guides</a></p>', '<a href="/guides/">Theatre trip guides</a> · ' + about + '</p>'],
  ['<a href="/guides/">Theatre trip guides</a></nav>', '<a href="/guides/">Theatre trip guides</a> ' + about + '</nav>'],
  ['Verify all details before purchasing.</section>', 'Verify all details before purchasing. <a href="/about/">About us &amp; contact</a></section>']
];
let n = 0;
for (const [from, to] of edits) {
  if (s.includes(from)) { s = s.split(from).join(to); n++; }
  else if (!s.includes(to)) console.warn('patch-about-links: anchor not found: ' + from);
}
fs.writeFileSync(file, s);
console.log('About links added (' + n + ' places).');
