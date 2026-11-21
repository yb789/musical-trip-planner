// Holiday weeks of the matinee pages (Thanksgiving, Christmas, New Year) and the utm_source of our
// own links in the visitor counter.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, apiGet, LOCAL } from "./fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Runs a snippet with the site's own code, from the repository root (lib/site-pages.js reads data/
// relative to the working folder), and returns what it prints as JSON.
const inSite = code => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" }));

// A week of sample performances: every day 14:00 and 19:00, except `dark` days (evening only).
const WEEK_DATA = `
  const week = (start, dark = []) => {
    const schedule = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.parse(start + "T12:00:00Z") + i * 86400000).toISOString().slice(0, 10);
      schedule[d] = ["Wicked", "Hamilton", "The Lion King"].flatMap(n => (dark.includes(d) ? ["19:00"] : ["14:00", "19:00"]).map(t => [n, t]));
    }
    const end = Object.keys(schedule).sort().pop();
    return { start, end, refreshedAt: "2026-11-21T00:00:00Z", shows: [], schedule };
  };`;

test.describe("holiday weeks on the matinee pages", () => {
  test("Thanksgiving week (Broadway) is a page of its own and says what happens on the holiday", () => {
    const r = inSite(`import { renderMatinees, holidayInfo } from "./lib/site-pages.js";${WEEK_DATA}
      const html = renderMatinees("new-york", week("2026-11-23", ["2026-11-26"]), { week: "2026-11-23", weeks: ["2026-11-23", "2026-11-30"] });
      const plain = renderMatinees("new-york", week("2026-11-30"), { week: "2026-11-30", weeks: ["2026-11-23", "2026-11-30"] });
      const london = renderMatinees("london", week("2026-11-23"), { week: "2026-11-23", weeks: ["2026-11-23"] });
      console.log(JSON.stringify({ html, plain, london, info: holidayInfo("new-york", "2026-11-23", "2026-11-29") }));`);
    expect(r.info.label).toBe("Thanksgiving");
    expect(r.info.days.map(d => d.date)).toEqual(["2026-11-26", "2026-11-27"]);
    // Its own title, address and heading, and Google may index it.
    expect(r.html).toMatch(/<title>Broadway Matinees Thanksgiving Week 2026 \(23–29 Nov\)/);
    expect(r.html).toContain('<link rel="canonical" href="https://musicaltripplanner.com/new-york/matinees/?week=2026-11-23">');
    expect(r.html).not.toContain("noindex");
    expect(r.html).toMatch(/<h1[^>]*>Broadway matinees in Thanksgiving week/);
    // The holiday line: nothing on the day itself, three shows the day after.
    expect(r.html).toContain("<b>Thanksgiving week:</b> No musical matinees are listed on Thanksgiving Day (Thursday 26 November); 3 musicals have a matinee on the Friday after Thanksgiving (Friday 27 November).");
    expect(r.html).toContain("Which Broadway musicals have a matinee on Thanksgiving Day 2026?");
    // An ordinary later week stays out of Google and keeps the main page as its canonical address.
    expect(r.plain).toContain('<meta name="robots" content="noindex,follow">');
    expect(r.plain).toContain('<link rel="canonical" href="https://musicaltripplanner.com/new-york/matinees/">');
    expect(r.plain).not.toContain("Thanksgiving week:");
    // Thanksgiving is not a London holiday.
    expect(r.london).toContain("noindex");
    expect(r.london).not.toContain("Thanksgiving week");
  });

  test("Christmas and New Year weeks, London and New York", () => {
    const r = inSite(`import { renderMatinees } from "./lib/site-pages.js";${WEEK_DATA}
      const xmasLondon = renderMatinees("london", week("2026-12-21", ["2026-12-25"]), { week: "2026-12-21", weeks: ["2026-12-21"] });
      const xmasNy = renderMatinees("new-york", week("2026-12-21", ["2026-12-25"]), { week: "2026-12-21", weeks: ["2026-12-21"] });
      const newYear = renderMatinees("london", week("2026-12-28", ["2027-01-01"]), { week: "2026-12-28", weeks: ["2026-12-28"] });
      console.log(JSON.stringify({ xmasLondon, xmasNy, newYear }));`);
    expect(r.xmasLondon).toMatch(/<title>West End Matinees Christmas Week 2026 \(21–27 Dec\)/);
    expect(r.xmasLondon).toContain("<b>Christmas week:</b> 3 musicals have a matinee on Christmas Eve (Thursday 24 December); no musical matinees are listed on Christmas Day (Friday 25 December); 3 musicals have a matinee on Boxing Day (Saturday 26 December).");
    expect(r.xmasLondon).not.toContain("noindex");
    expect(r.xmasNy).toMatch(/<title>Broadway Matinees Christmas Week 2026/);
    expect(r.xmasNy).not.toContain("Boxing Day");
    expect(r.newYear).toMatch(/<title>West End Matinees New Year Week 2027 \(28 Dec – 3 Jan\)/);
    // The apostrophes are escaped in the page (&#39;).
    expect(r.newYear).toContain("3 musicals have a matinee on New Year&#39;s Eve (Thursday 31 December); no musical matinees are listed on New Year&#39;s Day (Friday 1 January).");
    expect(r.newYear).toContain('href="https://musicaltripplanner.com/london/matinees/?week=2026-12-28"');
  });

  test("the main matinee page mentions a holiday inside its 7 days, and the sitemap lists holiday weeks", () => {
    const r = inSite(`import { renderMatinees, sitemapXml } from "./lib/site-pages.js";${WEEK_DATA}
      const main = renderMatinees("new-york", week("2026-11-21", ["2026-11-26"]), { week: "", weeks: ["2026-11-23"] });
      console.log(JSON.stringify({ main, map: sitemapXml("2026-11-21"), later: sitemapXml("2027-03-01") }));`);
    expect(r.main).toContain("<b>Thanksgiving week:</b> No musical matinees are listed on Thanksgiving Day");
    expect(r.main).toMatch(/<title>Broadway Matinees This Week/);
    expect(r.main).toContain('<link rel="canonical" href="https://musicaltripplanner.com/new-york/matinees/">');
    for (const loc of ["/new-york/matinees/?week=2026-11-23", "/new-york/matinees/?week=2026-12-21", "/london/matinees/?week=2026-12-21", "/london/matinees/?week=2026-12-28"]) {
      expect(r.map, loc).toContain(`<loc>https://musicaltripplanner.com${loc}</loc>`);
    }
    expect(r.map).not.toContain("/london/matinees/?week=2026-11-23");
    expect(r.later).not.toContain("?week=");
  });

  test("on the site: a holiday week in the week picker opens as an indexable page", async ({ page }) => {
    test.skip(LOCAL, "the matinees page reads the live schedule");
    await page.goto("/new-york/matinees/");
    const link = page.locator('nav.weeks a[href*="?week="]', { has: page.locator("small") }).first();
    test.skip(!(await link.count()), "no holiday week in the next 8 weeks");
    const label = (await link.locator("small").textContent()).trim();
    await link.click();
    await expect(page).toHaveURL(/\?week=\d{4}-\d{2}-\d{2}/);
    await expect(page).toHaveTitle(new RegExp(`Broadway Matinees ${label} Week`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${label} week`);
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBe(0);
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toContain("?week=");
  });
});

test.describe("utm_source in the visitor counter", () => {
  test("the server stores the name of our own links as the source", () => {
    const r = inSite(`import { normalizeEvent, utmRef } from "./lib/events.js"; import { sourceName } from "./lib/daily-report.js";
      const ev = (extra) => normalizeEvent({ event: "pageview", page: "/", city: "", ...extra }).ref;
      console.log(JSON.stringify({
        insta: ev({ utm: "instagram" }), fb: ev({ utm: "FB" }), wins: ev({ utm: "instagram", ref: "l.facebook.com" }),
        other: ev({ utm: "newsletter" }), bad: ev({ utm: "<script>", ref: "reddit.com" }), none: ev({ ref: "www.google.com" }),
        click: normalizeEvent({ event: "ticket_click", page: "/", utm: "instagram" }).ref,
        names: [sourceName("instagram.com"), sourceName("utm-newsletter"), sourceName("")], empty: utmRef("")
      }));`);
    expect(r.insta).toBe("instagram.com");
    expect(r.fb).toBe("facebook.com");
    expect(r.wins).toBe("instagram.com");
    expect(r.other).toBe("utm-newsletter");
    expect(r.bad).toBe("reddit.com");
    expect(r.none).toBe("google.com");
    expect(r.click).toBe("");
    expect(r.names).toEqual(["Instagram", "Our link: newsletter", "Direct / app (no source)"]);
    expect(r.empty).toBe("");
  });

  test("a page opened with ?utm_source=… sends the name with its page view", async ({ page }) => {
    // Catch the counter's beacons in the page instead of sending them: nothing reaches the stats.
    await page.addInitScript(() => {
      window.__beacons = [];
      navigator.sendBeacon = (url, body) => { Promise.resolve(body && body.text ? body.text() : String(body)).then(t => window.__beacons.push({ url, body: t })); return true; };
    });
    // notrack=0 switches this one browser's counter back on (the tests switch it off everywhere).
    await page.goto("/about/?notrack=0&utm_source=Instagram");
    await expect.poll(() => page.evaluate(() => window.__beacons.length)).toBeGreaterThan(0);
    const views = (await page.evaluate(() => window.__beacons)).filter(b => b.url === "/api/event").map(b => JSON.parse(b.body)).filter(b => b.event === "pageview");
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ page: "/about/", utm: "instagram" });

    // Without the tag nothing is added.
    await page.goto("/about/?notrack=0");
    await expect.poll(() => page.evaluate(() => window.__beacons.length)).toBeGreaterThan(0);
    const plain = (await page.evaluate(() => window.__beacons)).map(b => JSON.parse(b.body)).find(b => b.event === "pageview");
    expect(plain.utm).toBe("");
    // The pages load the new counter script.
    expect(await (await apiGet(page.request, "/about/")).text()).toContain("/events.js?v=3");
  });
});
