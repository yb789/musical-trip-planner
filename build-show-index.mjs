import fs from 'node:fs';

// Writes public/show-index.json: the names of every show in the guide, for the "Find a show by name"
// box on the site pages (static/show-search.js). Only what the box shows is included.
const index = {};
let count = 0;
for (const city of ['london', 'broadway']) {
  const shows = JSON.parse(fs.readFileSync(`data/shows-${city}.json`, 'utf8')).shows || [];
  index[city] = {
    shows: shows.map(({ id, title, match, venue, status, bookingUntil, limitedRun, familiar, kind, offBroadway, offWestEnd, closed }) =>
      ({ id, title, match, venue, ...(status === 'upcoming' ? { status } : {}), ...(bookingUntil ? { bookingUntil } : {}), ...(limitedRun ? { limitedRun: true } : {}),
        ...(familiar ? { familiar: true } : {}), ...(kind ? { kind } : {}), ...(offBroadway ? { offBroadway: true } : {}), ...(offWestEnd ? { offWestEnd: true } : {}), ...(closed ? { closed: true } : {}) }))
  };
  count += shows.length;
}
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/show-index.json', JSON.stringify(index));
console.log(`Show index written: public/show-index.json (${count} shows).`);
