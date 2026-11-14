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
