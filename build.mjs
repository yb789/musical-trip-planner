import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Vercel build entry point. vercel.json's buildCommand is limited to 256 characters,
// so the patch chain lives here. Order matters: later patches target strings that
// earlier patches produce.
const patches = [
  'patch-index.mjs',
  'patch-share-plan.mjs',
  'patch-ticket-links-placement.mjs',
  'patch-calendar-v2.mjs',
  'patch-price-simple.mjs',
  'patch-no-past-dates.mjs',
  'patch-date-calendar.mjs',
  'patch-ticket-confirmation.mjs',
  'patch-seatplan-link.mjs',
  'patch-show-tooltip.mjs'
];

for (const patch of patches) {
  console.log(`\n> node ${patch}`);
  execFileSync(process.execPath, [patch], { stdio: 'inherit' });
}

fs.mkdirSync('public', { recursive: true });
fs.copyFileSync('index.html', 'public/index.html');
for (const f of fs.readdirSync('static')) fs.copyFileSync(`static/${f}`, `public/${f}`);
console.log('\nBuild complete: public/index.html written.');
