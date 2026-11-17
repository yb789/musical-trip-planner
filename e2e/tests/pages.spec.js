// The site's pages and files outside the planner: they load, say what they should, link to the
// planner, and their ticket links go through /go.
import { test, expect, apiGet, reachSeller, bypassHeaders, LOCAL } from "./fixtures.js";

const CITIES = [
  { slug: "london", area: "West End" },
  { slug: "new-york", area: "Broadway" },
];

test.describe("information pages", () => {
  for (const [path, title, h1] of [
    ["/about/", /About & contact \| Musical Trip Planner/, "About Musical Trip Planner"],
    ["/terms/", /Terms of use \| Musical Trip Planner/, "Terms of use"],
    ["/privacy/", /Privacy policy \| Musical Trip Planner/, "Privacy policy"],
    ["/guides/", /Theatre trip guides/, "Theatre trip guides"],
  ]) {
    test(path, async ({ page }) => {
      const res = await page.goto(path);
      expect(res.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
      // The floating button that always leads back to the planner.
      await expect(page.locator("#fabPlanner")).toBeVisible();
    });
  }

  test("the same pages answer without the trailing slash", async ({ request }) => {
    for (const path of ["/about", "/terms", "/privacy", "/guides", "/london", "/new-york"]) {
      expect((await apiGet(request, path)).status(), path).toBe(200);
    }
  });

  test("every guide opens", async ({ page, request }) => {
    await page.goto("/guides/");
    const links = await page.locator('main a[href^="/guides/"]').evaluateAll(as => [...new Set(as.map(a => a.getAttribute("href")))].filter(h => h !== "/guides/"));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      const res = await apiGet(request, href);
      expect(res.status(), href).toBe(200);
      expect(await res.text(), href).toMatch(/<h1[^>]*>[^<]+/);
    }
  });

  test("an unknown address gives a 404 page, not an error", async ({ request }) => {
    for (const path of ["/guides/no-such-guide/", "/london/no-such-show-e2e/"]) {
      const res = await apiGet(request, path);
      expect(res.status(), path).toBe(404);
      expect(await res.text(), path).toContain("Musical Trip Planner");
    }
  });
});

for (const city of CITIES) {
  test.describe(`${city.area} pages`, () => {
    test("city page lists shows and leads to the planner", async ({ page }) => {
      const res = await page.goto(`/${city.slug}/`);
      expect(res.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(city.area);
      const shows = page.locator(`.card h3 a[href^="/${city.slug}/"]`);
      expect(await shows.count()).toBeGreaterThan(10);
      await page.locator("a.btn.primary").first().click();
      // The planner opens on the choose-dates screen with this city already selected.
      await expect(page.locator("#continueBtn")).toBeVisible();
      await expect(page.locator("#continueBtn")).toContainText(city.area);
    });

    test("a show page has performance times whose links reach the seller", async ({ page, context }) => {
      test.skip(LOCAL, "show pages read Ticketmaster live");
      await page.goto(`/${city.slug}/`);
      const hrefs = await page.locator(`.card h3 a[href^="/${city.slug}/"]`).evaluateAll(as => as.map(a => a.getAttribute("href")));
      // Not every show has dated links on a given day, so look through a few.
      let found = null;
      for (const href of hrefs.slice(0, 12)) {
        const res = await page.goto(href);
        expect(res.status(), href).toBe(200);
        await expect(page.getByRole("heading", { level: 1 })).not.toBeEmpty();
        const links = page.locator('a[href^="/go?"]');
        if (await links.count()) { found = { href, link: links.first() }; break; }
      }
      expect(found, `no ticket link on the first 12 ${city.area} show pages`).not.toBeNull();
      const target = new URL(await found.link.getAttribute("href"), page.url());
      const sellerPage = new URL(target.searchParams.get("u"));
      expect(sellerPage.protocol).toBe("https:");
      expect(sellerPage.hostname).toMatch(/(^|\.)(ticketmaster\.com|ticketmaster\.co\.uk|seatplan\.com)$/);
      expect(await found.link.getAttribute("rel")).toContain("nofollow");
      // Click it like a visitor: same tab or a new one, it must end on the seller (the stub).
      const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
      await found.link.scrollIntoViewIfNeeded();
      await found.link.click();
      const dest = (await found.link.getAttribute("target")) === "_blank" ? await popup : page;
      expect(dest, "the ticket link opened nothing").not.toBeNull();
      const { viaContinuePage } = await reachSeller(dest);
      expect(viaContinuePage, "the ticket link was answered with the Continue page instead of going straight to the seller").toBe(false);
    });

    test("matinees page shows this week and can switch week", async ({ page }) => {
      test.skip(LOCAL, "the matinees page reads the live schedule");
      const res = await page.goto(`/${city.slug}/matinees/`);
      expect(res.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/matinee/i);
      expect(await page.locator(`main a[href^="/${city.slug}/"]`).count()).toBeGreaterThan(3);
      const week = page.locator('a[href*="?week="]').first();
      await expect(week).toBeVisible();
      await week.click();
      await expect(page).toHaveURL(/\?week=\d{4}-\d{2}-\d{2}/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/matinee/i);
    });
  });
}

// Since 9 October 2026 Harry Potter and the Cursed Child in London is one show of about 2h 55m
// (Tue–Sun, matinees Wed, Sat and Sun), no longer Part One and Part Two. The London page must not
// describe it as two parts or give Part One / Part Two times. Running time comes from the show data.
test.describe("Cursed Child (London) is one show", () => {
  test("its page gives one running time and no parts", async ({ page }) => {
    const res = await page.goto("/london/harry-potter-and-the-cursed-child/");
    expect(res.status()).toBe(200);
    const main = page.locator("main");
    await expect(page.locator(".faq")).toContainText("The running time of Harry Potter and the Cursed Child is about 2 hours 55 minutes");
    await expect(main).not.toContainText("Two-part play");
    await expect(main).not.toContainText("Part Two");
  });

  test("the London city page doesn't call it two parts", async ({ page }) => {
    await page.goto("/london/");
    await expect(page.locator("main")).not.toContainText("Cursed Child is two parts");
  });
});

// Show facts audit, 17 November 2026: every running show was re-checked against the Society of
// London Theatre / Broadway League listings and, where they disagreed, the theatre's or show's own
// page. These are the facts that were wrong on the site. The first two tests read the data files
// (they need no server); the last one reads the pages the facts end up on.
test.describe("show facts (audit of 17 Nov 2026)", () => {
  const readGuide = async city => JSON.parse(await (await import("node:fs/promises")).readFile(new URL(`../../data/shows-${city}.json`, import.meta.url), "utf8")).shows;
  const FIXED = {
    london: [
      ["the-lion-king", { bookingUntil: "2027-07-25" }],
      ["the-book-of-mormon", { bookingUntil: "2027-03-20" }],
      ["moulin-rouge-the-musical", { bookingUntil: "2027-07-03", runtime: "2h 45m, 1 interval" }],
      ["operation-mincemeat", { bookingUntil: "2027-05-29", runtime: "2h 35m, 1 interval" }],
      ["rent", { bookingUntil: "2027-05-29" }],
      ["come-alive", { bookingUntil: "2027-08-29" }],
      ["high-school-musical", { runtime: "2h 20m, 1 interval" }],
      ["stranger-things-the-first-shadow", { bookingUntil: "2026-12-23" }],
      ["the-hunger-games-on-stage", { bookingUntil: "2027-02-14", runtime: "2h 30m, 1 interval" }],
      ["the-mousetrap", { bookingUntil: "2027-07-17", runtime: "2h 05m, 1 interval" }],
      ["the-play-that-goes-wrong", { bookingUntil: "2028-01-30" }],
      ["witness-for-the-prosecution", { bookingUntil: "2027-09-19" }],
      ["oh-mary", { bookingUntil: "2027-06-05" }],
      ["one-day", { status: "running" }],
      ["pride", { status: "running" }],
      ["kimberly-akimbo", { bookingUntil: "2026-11-14" }],
      ["harry-potter-and-the-cursed-child", { runtime: "2h 55m, 1 interval" }],
    ],
    broadway: [
      ["harry-potter-and-the-cursed-child", { runtime: "2h 55m, 1 intermission" }],
      ["just-in-time", { runtime: "2h 30m, 1 intermission" }],
      ["buena-vista-social-club", { bookingUntil: "2027-01-17" }],
      ["the-rocky-horror-show", { bookingUntil: "2027-02-28" }],
      ["schmigadoon", { bookingUntil: "2027-04-04" }],
      ["paranormal-activity", { bookingUntil: "2027-02-28", runtime: "2h 10m, 1 intermission" }],
      ["a-few-good-men", { bookingUntil: "2027-01-10", runtime: "2h 35m, 1 intermission" }],
      ["the-fantasticks", { bookingUntil: "2027-02-07", runtime: "2h 05m, 1 intermission" }],
      ["stranger-things-the-first-shadow", { runtime: "2h 45m, 1 intermission" }],
      ["galileo", { status: "running" }],
    ],
  };

  for (const city of ["london", "broadway"]) {
    test(`${city}: the corrected running times, dates and statuses are in the guide data`, async () => {
      const byId = new Map((await readGuide(city)).map(s => [s.id, s]));
      for (const [id, facts] of FIXED[city]) {
        expect(byId.has(id), `${city}/${id} is in the guide`).toBe(true);
        for (const [field, value] of Object.entries(facts)) expect(byId.get(id)[field], `${city}/${id} ${field}`).toBe(value);
      }
    });

    // A date written out in "dates" ("Booking until 25 Jul 2027") and the machine date in
    // "bookingUntil" must be the same day: the page text uses one, hiding ended shows uses the other.
    test(`${city}: the written date and bookingUntil agree for every show`, async () => {
      const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      for (const s of await readGuide(city)) {
        const all = [...String(s.dates || "").matchAll(/(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{4})/g)];
        if (!all.length || !s.bookingUntil) continue;
        const [, d, m, y] = all[all.length - 1];
        const iso = `${y}-${String(MONTHS.indexOf(m) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        expect(s.bookingUntil, `${city}/${s.id}: "${s.dates}"`).toBe(iso);
      }
    });
  }

  test("show pages give the corrected running times", async ({ page }) => {
    test.skip(LOCAL, "show pages read Ticketmaster live");
    for (const [path, title, text] of [
      ["/new-york/harry-potter-and-the-cursed-child/", "Harry Potter and the Cursed Child", "about 2 hours 55 minutes"],
      ["/new-york/just-in-time/", "Just in Time", "about 2 hours 30 minutes"],
      ["/london/the-mousetrap/", "The Mousetrap", "about 2 hours 5 minutes"],
      ["/london/operation-mincemeat/", "Operation Mincemeat", "about 2 hours 35 minutes"],
    ]) {
      const res = await page.goto(path);
      expect(res.status(), path).toBe(200);
      await expect(page.locator(".faq"), path).toContainText(`The running time of ${title} is ${text}`);
    }
  });
});

test.describe("files other services rely on", () => {
  test("robots.txt, sitemap, llms.txt", async ({ request }) => {
    const robots = await (await apiGet(request, "/robots.txt")).text();
    expect(robots).toContain("Sitemap: https://musicaltripplanner.com/sitemap.xml");
    expect(robots).toMatch(/Disallow:\s*\/api\//);

    const sitemap = await (await apiGet(request, "/sitemap.xml")).text();
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    expect(locs.length).toBeGreaterThan(50);
    for (const need of ["https://musicaltripplanner.com/", "https://musicaltripplanner.com/london/", "https://musicaltripplanner.com/new-york/", "https://musicaltripplanner.com/guides/"]) expect(locs).toContain(need);
    expect(locs.every(l => l.startsWith("https://musicaltripplanner.com/"))).toBe(true);
    expect(locs.some(l => l.includes("/go"))).toBe(false);

    const llms = await apiGet(request, "/llms.txt");
    expect(llms.status()).toBe(200);
    expect(await llms.text()).toContain("Musical Trip Planner");
  });

  test("a sample of sitemap pages opens", async ({ request }) => {
    test.skip(LOCAL, "show pages read Ticketmaster live");
    const sitemap = await (await apiGet(request, "/sitemap.xml")).text();
    const paths = [...sitemap.matchAll(/<loc>https:\/\/musicaltripplanner\.com([^<]*)<\/loc>/g)].map(m => m[1] || "/");
    // Every 10th address: a different mix of city, show and guide pages, without loading all of them.
    const sample = paths.filter((_, i) => i % 10 === 0);
    for (const path of sample) expect((await apiGet(request, path)).status(), path).toBe(200);
  });

  test("app files: manifest, Android link file, service worker, icons", async ({ request }) => {
    const manifest = await (await apiGet(request, "/site.webmanifest")).json();
    expect(manifest.name).toContain("Musical Trip Planner");
    expect(manifest.icons.length).toBeGreaterThan(0);

    const links = await apiGet(request, "/.well-known/assetlinks.json");
    expect(links.headers()["content-type"]).toContain("application/json");
    expect(JSON.stringify(await links.json())).toContain("com.musicaltripplanner.app");

    const sw = await apiGet(request, "/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["cache-control"]).toContain("no-cache");

    if (!LOCAL) for (const icon of manifest.icons) {
      const res = await apiGet(request, new URL(icon.src, "https://x/").pathname);
      expect(res.status(), icon.src).toBe(200);
      expect(res.headers()["content-type"], icon.src).toContain("image/png");
    }
  });

  test("the site's own certificate is valid", async ({ playwright, baseURL }) => {
    test.skip(LOCAL, "the local copy is plain http");
    // The browsers in these tests accept any certificate (needed for the seller stub), so check here.
    const strict = await playwright.request.newContext({ ignoreHTTPSErrors: false });
    expect((await strict.get(baseURL + "/robots.txt", { headers: bypassHeaders })).status()).toBe(200);
    await strict.dispose();
  });

  test("security headers are sent", async ({ request }) => {
    for (const path of ["/", "/about/", "/go?u=https%3A%2F%2Fwww.seatplan.com%2Flondon%2Fwicked-tickets%2F&nt=1"]) {
      const h = (await apiGet(request, path)).headers();
      expect(h["content-security-policy"], path).toContain("default-src 'self'");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["x-frame-options"], path).toBe("DENY");
    }
  });
});
