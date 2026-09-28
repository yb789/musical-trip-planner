import fs from 'node:fs';

// Inlines the opening screen + "Help me choose" helper, with the show guide data for both cities.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');
const css = fs.readFileSync('show-helper.css', 'utf8');
const js = fs.readFileSync('show-helper.js', 'utf8');
const guide = {
  london: JSON.parse(fs.readFileSync('data/shows-london.json', 'utf8')),
  broadway: JSON.parse(fs.readFileSync('data/shows-broadway.json', 'utf8'))
};
// Keep only what the page needs, and make the JSON safe inside a <script> tag.
const slim = Object.fromEntries(Object.entries(guide).map(([city, d]) => [city, {
  shows: d.shows.map(({ id, title, match, venue, status, dates, bookingUntil, limitedRun, vibes, audience, familiar, runtime, blurb, listen }) =>
    ({ id, title, match, venue, status, dates, bookingUntil, limitedRun, vibes, audience, familiar, runtime, blurb, listen }))
}]));
const data = JSON.stringify(slim).replace(/</g, '\\u003c');

s = s.replace(/\s*<style id=["']show-helper-style["'][\s\S]*?<\/style>\s*/gi, '\n');
s = s.replace(/\s*<script id=["']show-helper-flag["'][\s\S]*?<\/script>\s*/gi, '\n');
s = s.replace(/\s*<script id=["']show-helper-script["'][\s\S]*?<\/script>\s*/gi, '\n');
// Crawlable links from the planner's intro to the show pages and guides.
s = s.replace(/\s*<p id="mh-browse"[\s\S]*?<\/p>/, '');
s = s.replace(/(<section class="intro panel">[\s\S]*?)(<\/section>)/, '$1<p id="mh-browse" class="small">Browse: <a href="/london/">West End musicals</a> · <a href="/new-york/">Broadway musicals</a> · <a href="/guides/">Theatre trip guides</a></p>$2');
s = s.replace('</head>', `<script id="show-helper-flag">window.MH_SHARED_PLAN=/[?&]plan=/.test(location.search)</script>\n<style id="show-helper-style">\n${css}\n</style>\n</head>`);
s = s.replace('</body>', `<script id="show-helper-script">\nwindow.SHOW_GUIDE=${data};\n${js}\n</script>\n</body>`);

fs.writeFileSync(file, s);
console.log(`Show helper inlined (${guide.london.shows.length} London, ${guide.broadway.shows.length} Broadway shows).`);
