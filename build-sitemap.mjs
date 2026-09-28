import fs from 'node:fs';
import { sitemapXml } from './lib/site-pages.js';

// Writes public/sitemap.xml with the planner, city hubs, every show page and every guide.
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/sitemap.xml', sitemapXml());
console.log('Sitemap written: public/sitemap.xml');
