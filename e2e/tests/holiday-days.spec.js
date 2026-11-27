// Christmas & New Year day pages (27 Nov 2026): /london/christmas-eve/, /london/christmas-day/,
// /london/boxing-day/, /london/new-years-eve/, /london/new-years-day/ and the same for New York
// (no Boxing Day). Every show playing that day, matinee and evening, with finish times and
// Ticketmaster and SeatPlan buttons for that performance.
//
// The first test renders the pages from the site's code with a made-up schedule (local copy only:
// the pages read the live schedule). The second opens the real pages on a deployed site.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, reachSeller, LOCAL } from "./fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const inSite = code => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const CODE_ONLY = "checks the site's code; runs with the local copy, where the site's packages are installed";
const LONDON = ["christmas-eve", "christmas-day", "boxing-day", "new-years-eve", "new-years-day"];
const NEW_YORK = ["christmas-eve", "christmas-day", "new-years-eve", "new-years-day"];

test.describe("Christmas & New Year day pages", () => {
  test("list every show of the day with times, finish times and both sellers", () => {
    test.skip(!LOCAL, CODE_ONLY);
    const r = inSite(`import { renderHolidayDay, holidayDate, holidayDayUrls, sitemapXml, renderCity, renderMatinees } from "./lib/site-pages.js";
      const now = new Date("2026-11-27T10:00:00Z");
      const data = { start: "2026-12-21", end: "2026-12-27", refreshedAt: "2026-11-27T03:00:00Z",
        shows: [{ name: "Wicked", venue: "Apollo Victoria Theatre" }],
        schedule: { "2026-12-24": [["Wicked", "14:30"], ["Wicked", "14:30"]], "2026-12-25": [],
          "2026-12-26": [["Wicked", "19:30"], ["Les Misérables", "14:30"], ["Wicked", "14:30"], ["Hamilton", "19:30"]] } };
      const spShows = [{ name: "Wicked", href: "https://seatplan.com/london/wicked-tickets/" }];
      const boxing = renderHolidayDay("london", "boxing-day", data, { now, spShows });
      console.log(JSON.stringify({
        boxing, eve: renderHolidayDay("london", "christmas-eve", data, { now, spShows }),
        xmas: renderHolidayDay("london", "christmas-day", data, { now, spShows }),
        nyBoxing: renderHolidayDay("new-york", "boxing-day", data, { now }),
        unlisted: renderHolidayDay("london", "new-years-day", null, { now }),
        dates: { nyd: holidayDate("new-years-day", now), eveAfter: holidayDate("christmas-eve", new Date("2026-12-25T10:00:00Z")) },
        near: holidayDayUrls(now).map(d => d.url), far: holidayDayUrls(new Date("2026-06-01T10:00:00Z")).length,
        sitemap: sitemapXml("2026-11-27"), city: renderCity("london"),
        week: renderMatinees("london", data, { week: "2026-12-21", weeks: ["2026-12-21"] })
      }));`);
    // Boxing Day: title, both sessions in start-time order, finish times from the running time.
    expect(r.boxing).toContain("<title>West End Shows on Boxing Day 2026: Matinees, Evening Shows &amp; Finish Times</title>");
    expect(r.boxing).toContain("Saturday 26 December 2026");
    expect(r.boxing).toContain("3 West End shows are listed on Boxing Day 2026 (Saturday 26 December 2026): 2 matinees and 2 evening performances.");
    const section = (html, id) => (html.split(`id="${id}"`)[1] || "").split("</table>")[0];
    expect(section(r.boxing, "matinees")).toMatch(/Les Misérables[\s\S]*2:30 pm[\s\S]*Wicked[\s\S]*2:30 pm[\s\S]*5:15 pm/);
    expect(section(r.boxing, "evening")).toMatch(/Hamilton[\s\S]*7:30 pm[\s\S]*Wicked[\s\S]*7:30 pm[\s\S]*10:15 pm/);
    expect(r.boxing).toContain('href="/london/wicked/"');
    // SeatPlan opens that performance, through /go, tagged holiday-<show>; none when SeatPlan doesn't list the show.
    const sp = [...r.boxing.matchAll(/<a class="chip sp" href="([^"]+)"/g)].map(m => new URL(m[1].replace(/&amp;/g, "&"), "https://musicaltripplanner.com"));
    expect(sp.map(u => u.pathname)).toEqual(["/go", "/go"]);
    expect(sp.map(u => u.searchParams.get("u"))).toEqual(["https://seatplan.com/london/wicked-tickets/tickets/26-dec-2026/2-30pm/", "https://seatplan.com/london/wicked-tickets/tickets/26-dec-2026/7-30pm/"]);
    expect(sp.map(u => u.searchParams.get("subId1"))).toEqual(["holiday-wicked", "holiday-wicked"]);
    // Ticketmaster: filled in by the page from /api/tm-link (src=holiday), hidden until then.
    expect((r.boxing.match(/<a class="chip tm" hidden data-tm="[^"]+" data-time="\d\d:\d\d"/g) || []).length).toBe(4);
    expect(r.boxing).toContain("/api/tm-link?city=london&src=holiday&date=2026-12-26");
    // The same show and time listed twice appears once.
    expect((section(r.eve, "matinees").match(/href="\/london\/wicked\/"/g) || []).length).toBe(1);
    // Christmas Day with nothing listed says so plainly and is still a page Google may show.
    expect(r.xmas).toContain("No West End shows are listed on Christmas Day 2026 (Friday 25 December 2026).");
    expect(r.xmas).not.toContain('content="noindex');
    // No Boxing Day page for New York; a day not listed yet is noindex and says so.
    expect(r.nyBoxing).toBeNull();
    expect(r.unlisted).toContain("aren't listed yet");
    expect(r.unlisted).toMatch(/<meta name="robots" content="noindex/);
    // Dates: the next occurrence, today included.
    expect(r.dates).toEqual({ nyd: "2027-01-01", eveAfter: "2027-12-24" });
    // While the holidays are within the listings' reach: 9 pages, in the sitemap, linked from the
    // city page and from the holiday-week matinee page. Far from Christmas: none.
    expect(r.near).toHaveLength(9);
    expect(r.far).toBe(0);
    for (const u of r.near) expect(r.sitemap).toContain(`<loc>https://musicaltripplanner.com${u}</loc>`);
    expect(r.city).toContain('href="/london/christmas-eve/">Shows over Christmas &amp; New Year</a>');
    expect(r.week).toContain('see <a href="/london/christmas-eve/">Christmas Eve</a>, <a href="/london/christmas-day/">Christmas Day</a> and <a href="/london/boxing-day/">Boxing Day</a>');
  });

  test("the live pages load, link each other and their ticket buttons reach the sellers", async ({ page, context }) => {
    test.skip(LOCAL, "the day pages read the live schedule");
    for (const [city, days] of [["london", LONDON], ["new-york", NEW_YORK]]) {
      for (const day of days) {
        const res = await page.goto(`/${city}/${day}/`);
        expect(res.status(), `/${city}/${day}/`).toBe(200);
        await expect(page.locator("h1")).toContainText(city === "london" ? "West End shows on" : "Broadway shows on");
        // The day links: one per holiday of that city, the current one marked.
        await expect(page.locator(".hdnav a[href$='/']")).toHaveCount(days.length);
        await expect(page.locator(`.hdnav a[aria-current="page"][href="/${city}/${day}/"]`)).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `/${city}/${day}/ is wider than the screen`).toBe(true);
        for (const a of await page.locator("a.chip.sp").all()) {
          const u = new URL(await a.getAttribute("href"), page.url());
          expect(u.pathname).toBe("/go");
          expect(u.searchParams.get("subId1")).toMatch(/^holiday-[a-z0-9-]+$/);
          expect(new URL(u.searchParams.get("u")).pathname).toMatch(/-tickets\/tickets\/\d{1,2}-[a-z]{3}-\d{4}\/\d{1,2}-\d{2}(am|pm)\/$/);
        }
      }
    }
    // New York has no Boxing Day page.
    expect((await page.goto("/new-york/boxing-day/")).status()).toBe(404);
    // Ticketmaster buttons appear once /api/tm-link answers, tagged holiday-<show>; a SeatPlan button reaches the seller.
    let clicked = false;
    for (const url of ["/london/boxing-day/", "/london/christmas-eve/", "/new-york/christmas-eve/", "/london/new-years-day/"]) {
      await page.goto(url);
      const tm = page.locator("a.chip.tm:not([hidden])");
      await tm.first().waitFor({ timeout: 8000 }).catch(() => {});
      for (const a of (await tm.all()).slice(0, 3)) await expect(a).toHaveAttribute("href", /^\/go\?u=https%3A%2F%2F[^&]+&subId1=holiday-[a-z0-9-]+$/);
      const sp = page.locator("a.chip.sp").first();
      if (!clicked && await sp.count()) {
        const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
        await sp.evaluate(el => el.scrollIntoView({ block: "center" }));
        await sp.click();
        const dest = await popup;
        expect(dest, "the SeatPlan button opened nothing").not.toBeNull();
        const { viaContinuePage } = await reachSeller(dest);
        expect(viaContinuePage).toBe(false);
        clicked = true;
      }
    }
  });
});
