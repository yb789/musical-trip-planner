import fs from 'node:fs';

// Installable app (PWA / Android Trusted Web Activity) support for the planner page:
//  - registers the service worker /sw.js (static/sw.js: offline page, never caches /api/*);
//  - adds a "Privacy" link next to "About us & contact" in the ticket disclaimer.
// Runs last in build.mjs. Anchors: the last </body> and the about-link text written by
// patch-about-links.mjs. Safe to run twice.
const file = 'index.html';
let s = fs.readFileSync(file, 'utf8');

const marker = 'id="pwa-sw-register"';
if (!s.includes(marker)) {
  const script = `<script ${marker}>if('serviceWorker' in navigator&&location.protocol==='https:'){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(e){console.warn('service worker registration failed',e)})})}</script>\n`;
  const at = s.lastIndexOf('</body>');
  if (at < 0) { console.error('patch-pwa: </body> not found'); process.exit(1); }
  s = s.slice(0, at) + script + s.slice(at);
}

const aboutLink = '<a href="/about/">About us &amp; contact</a></section>';
const withPrivacy = '<a href="/about/">About us &amp; contact</a> · <a href="/privacy/">Privacy</a></section>';
if (s.includes(aboutLink)) s = s.split(aboutLink).join(withPrivacy);
else if (!s.includes(withPrivacy)) { console.error('patch-pwa: about link in the disclaimer not found'); process.exit(1); }

// Terms link next to Privacy (added Nov 2026 for the Google Play listing).
const privacyEnd = '<a href="/privacy/">Privacy</a></section>';
const withTerms = '<a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a></section>';
if (s.includes(privacyEnd)) s = s.split(privacyEnd).join(withTerms);

fs.writeFileSync(file, s);
console.log('PWA: service worker registration, privacy and terms links added.');
