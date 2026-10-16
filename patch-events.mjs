import fs from 'node:fs';

// Includes the own usage counter (static/events.js) in the planner page and fires
// share_created when a share link has been made. Safe to run twice.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const tag = '<script defer src="/events.js"></script>';
const anchor = '<script defer src="/_vercel/insights/script.js"></script>';
if (!s.includes(tag)) {
  if (!s.includes(anchor)) { console.error('patch-events: insights script tag not found'); process.exit(1); }
  s = s.replace(anchor, anchor + '\n' + tag);
}
const shareFrom = "$('shareReady').classList.remove('hidden')}catch(e){console.error(e)";
const shareTo = "$('shareReady').classList.remove('hidden');window.mtpTrack&&mtpTrack('share_created')}catch(e){console.error(e)";
if (!s.includes(shareTo)) {
  if (!s.includes(shareFrom)) { console.error('patch-events: share success anchor not found'); process.exit(1); }
  s = s.replace(shareFrom, shareTo);
}
fs.writeFileSync(file, s);
console.log('patch-events: events.js included, share_created hooked.');
