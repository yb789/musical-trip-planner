// "Find a show by name": the box on the planner's opening screen and at the top of every site page.
// A result is a link to the show's own page, where the times and the ticket buttons are.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, apiGet, tripDates, LOCAL } from "./fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const inSite = code => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" }));
const CODE_ONLY = "checks the site's code; runs with the local copy, where the site's packages are installed";

const box = page => page.locator("[data-show-search] input");
const options = page => page.locator("[data-show-search] .ss-opt");
const hrefs = page => options(page).evaluateAll(as => as.map(a => a.getAttribute("href")));

async function openStart(page) {
  await page.goto("/#/start");
  await expect(page.locator("#mhTitle")).toBeVisible();
  await expect(box(page)).toBeVisible();
}

test.describe("opening screen", () => {
  test("a show that plays in both cities is offered for London and for New York", async ({ page }) => {
    await openStart(page);
    await expect(page.locator("#mhSearch label")).toHaveText("Looking for a specific show?");
    await box(page).fill("wick");
    await expect(options(page)).toHaveCount(2);
    expect((await hrefs(page)).sort()).toEqual(["/london/wicked/", "/new-york/wicked/"]);
    await expect(options(page).filter({ hasText: "London" })).toHaveAttribute("href", "/london/wicked/");
    await expect(options(page).filter({ hasText: "New York" })).toHaveAttribute("href", "/new-york/wicked/");
    // The list stays inside the screen on a phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the chosen city comes first, and what was typed survives changing the city", async ({ page }) => {
    await openStart(page);
    await page.getByRole("button", { name: "London · West End", exact: true }).click();
    await box(page).fill("hamilton");
    await expect(options(page).first()).toHaveAttribute("href", "/london/hamilton/");
    await box(page).press("Escape"); // the list lies over the city buttons while it is open
    await page.getByRole("button", { name: "New York · Broadway", exact: true }).click();
    await expect(box(page)).toHaveValue("hamilton");
    await box(page).press("ArrowDown"); // opens the list again
    await expect(options(page).first()).toHaveAttribute("href", "/new-york/hamilton/");
  });

  test("short names, missing accents, typing slips and shows that are not musicals", async ({ page }) => {
    await openStart(page);
    for (const [typed, href] of [
      ["les mis", "/london/les-mis-rables/"],
      ["Les Misérables", "/london/les-mis-rables/"],
      ["lion king", "/london/the-lion-king/"],
      ["phantom", "/london/the-phantom-of-the-opera/"],
      ["hamiltn", "/london/hamilton/"],
      ["mama mia", "/london/mamma-mia/"],
      ["mousetrap", "/london/the-mousetrap/"],
      ["abba", "/london/abba-voyage/"],
      ["rockettes", "/new-york/radio-city-christmas-spectacular/"],
      ["and juliet", "/new-york/juliet/"],
      ["& juliet", "/new-york/juliet/"],
    ]) {
      await box(page).fill(typed);
      await expect(options(page).first(), typed).toBeVisible();
      expect(await hrefs(page), typed).toContain(href);
    }
    // Names that only look alike are not offered: none of these shows is in the guide.
    for (const typed of ["cats", "grease", "frozen", "annie"]) {
      await box(page).fill(typed);
      await expect(page.locator("[data-show-search] .ss-msg"), typed).toContainText("No show called");
    }
    await box(page).fill("lion");
    await expect(options(page)).toHaveCount(2); // The Lion King twice, not "Million Dollar Quartet"
    // A play says that it is a play, in both cities.
    await box(page).fill("harry potter");
    await expect(options(page)).toHaveCount(2);
    for (const o of await options(page).all()) await expect(o).toContainText("Play");
  });

  test("a name that is not in the guide gets a clear answer and a way on", async ({ page }) => {
    await openStart(page);
    await box(page).fill("zzqqxx the musical");
    const msg = page.locator("[data-show-search] .ss-msg");
    await expect(msg).toContainText("No show called");
    await expect(msg.locator('a[href="/london/"]')).toBeVisible();
    await expect(msg.locator('a[href="/new-york/"]')).toBeVisible();
    await expect(options(page)).toHaveCount(0);
    // One letter is not searched; Escape closes the list and leaves the opening screen open.
    await box(page).fill("w");
    await expect(page.locator("[data-show-search] .ss-panel")).toBeHidden();
    await box(page).fill("wicked");
    await expect(options(page).first()).toBeVisible();
    await box(page).press("Escape");
    await expect(page.locator("[data-show-search] .ss-panel")).toBeHidden();
    await expect(page.locator("#mhTitle")).toBeVisible();
  });

  test("the rest of the opening screen still works with the box there", async ({ page }) => {
    await openStart(page);
    await box(page).fill("wicked");
    await expect(options(page).first()).toBeVisible();
    await page.locator('button.mh-card[data-act="know"]').click();
    await expect(page.locator("#continueBtn")).toBeVisible();
  });
});

test.describe("site pages", () => {
  for (const path of ["/london/", "/new-york/", "/guides/", "/about/"]) {
    test(`${path} has the box`, async ({ page }) => {
      await page.goto(path);
      await expect(box(page)).toBeVisible();
      await expect(box(page)).toHaveAttribute("aria-label", "Find a show by name");
      await box(page).fill("lion king");
      await expect(options(page)).toHaveCount(2);
      // On a city's own pages that city's show comes first.
      const first = await options(page).first().getAttribute("href");
      if (path === "/new-york/") expect(first).toBe("/new-york/the-lion-king/");
      else if (path === "/london/") expect(first).toBe("/london/the-lion-king/");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test("Enter opens the first result's page", async ({ page }) => {
    // The local copy has no database for show pages, so there the page itself is a stand-in.
    if (LOCAL) await page.route("**/new-york/hamilton/", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Hamilton</title><h1>Hamilton</h1>" }));
    await page.goto("/new-york/");
    await box(page).fill("hamil");
    await expect(options(page).first()).toHaveAttribute("href", "/new-york/hamilton/");
    await box(page).press("Enter");
    await page.waitForURL("**/new-york/hamilton/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hamilton");
  });

  test("the arrow keys choose a result, and a tap on one is an ordinary link", async ({ page }) => {
    if (LOCAL) await page.route("**/london/wicked/", r => r.fulfill({ contentType: "text/html", body: "<!doctype html><title>Wicked</title><h1>Wicked</h1>" }));
    await page.goto("/new-york/");
    await box(page).fill("wicked");
    await expect(options(page)).toHaveCount(2);
    await box(page).press("ArrowDown");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await box(page).press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(options(page).nth(1)).toHaveAttribute("href", "/london/wicked/");
    await options(page).nth(1).click();
    await page.waitForURL("**/london/wicked/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Wicked");
  });

  test("every show in the guide can be found by its name, and its page exists in the sitemap", async ({ page, request }) => {
    const index = await (await apiGet(request, "/show-index.json")).json();
    const sitemap = await (await apiGet(request, "/sitemap.xml")).text();
    await page.goto("/about/");
    await expect(box(page)).toBeVisible();
    const all = Object.entries(index).flatMap(([city, d]) => d.shows.map(s => ({ title: s.title, href: `/${city === "broadway" ? "new-york" : "london"}/${s.id}/` })));
    expect(all.length).toBeGreaterThan(80);
    const missing = await page.evaluate(async list => {
      const out = [];
      for (const s of list) {
        const found = await window.mtpShowSearch._search(s.title, "");
        if (!found.some(f => f.href === s.href)) out.push(s.title);
      }
      return out;
    }, all);
    expect(missing).toEqual([]);
    // Results only ever point at pages the site has.
    const unknown = all.filter(s => !sitemap.includes(`https://musicaltripplanner.com${s.href}<`)).map(s => s.href);
    expect(unknown).toEqual([]);
  });
});

// ---------- "Find a show" inside the planner ----------
const SCHEDULE_WAIT = LOCAL ? 15_000 : 150_000;
// Start screen -> planner with a 3-day trip and the schedule loaded (as in planner.spec.js).
async function openPlanner(page, startButton = "London · West End") {
  await page.goto("/");
  await expect(page.locator("#mhTitle")).toHaveText("Welcome to your Musical Planner");
  await page.getByRole("button", { name: startButton, exact: true }).click();
  await page.locator("button.mh-card:not(.mh-feature)").click();
  const { start, end } = tripDates();
  if (start.getMonth() !== new Date().getMonth()) await page.locator("#pickerNext").click();
  const day = n => page.locator("button.picker-day:not(.past-date)").filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) });
  await day(start.getDate()).click();
  await day(end.getDate()).click();
  await expect(page.locator("button.picker-day.in-range")).toHaveCount(3);
  await page.locator("#continueBtn").click();
  await expect(page.locator("button.pc-slot.empty").filter({ hasText: /Choose/ }).first()).toBeVisible({ timeout: SCHEDULE_WAIT });
  await expect(page.locator("#pfInput")).toBeVisible();
}
const found = page => page.locator("#pfResults .pf-show");
const times = page => page.locator("#pfResults button.pf-time");

test.describe("inside the planner", () => {
  test.describe.configure({ timeout: LOCAL ? 60_000 : 360_000 });

  for (const startButton of ["London · West End", "New York · Broadway"]) {
    test(`${startButton}: a show is found on the trip's dates and a tap on a time adds it to the plan`, async ({ page }) => {
      await openPlanner(page, startButton);
      // A show that is on the calendar, taken from the schedule the page has loaded.
      const show = await page.evaluate(() => {
        const sch = current().schedule, per = new Map();
        for (const d of days()) for (const [n, t] of (sch[d] || [])) if (kindAllowed(n) && !state.excluded[state.city].has(n)) per.set(n, [...(per.get(n) || []), d + " " + t]);
        const [name, list] = [...per].sort((a, b) => b[1].length - a[1].length)[0];
        return { name, title: cleanShowTitle(name), count: list.length, dates: new Set(list.map(x => x.slice(0, 10))).size };
      });
      await page.locator("#pfInput").fill(show.title);
      const card = page.locator(`#pfResults .pf-show[data-show-name=${JSON.stringify(show.name)}]`);
      await expect(card).toBeVisible();
      await expect(card.locator("button.pf-time")).toHaveCount(show.count);
      await expect(card).toContainText(`Plays on ${show.dates} of your 3 days`);
      if (await found(page).count() === 1) await expect(page.locator("#planCal .pc-day.pf-hit")).toHaveCount(show.dates);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await expect(page.locator("button.pc-slot.filled")).toHaveCount(0);
      const first = card.locator("button.pf-time").first();
      const when = await first.evaluate(b => ({ date: b.dataset.date, time: b.dataset.time }));
      await first.click();
      await expect(page.locator("button.pc-slot.filled")).toHaveCount(1);
      await expect(page.locator(`button.pc-slot.filled[data-date="${when.date}"]`)).toContainText(show.title);
      // The time now shows as in the plan, and the plan is saved.
      await expect(card.locator("button.pf-time.on")).toHaveCount(1);
      await expect(card.locator("button.pf-time.on")).toBeDisabled();
      const saved = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("musicalPlannerLive")).choices));
      expect(saved).toContain(when.time);
      expect(saved).toContain(JSON.stringify(show.name).slice(1, -1));

      // Clear: results and outlines go, the choice stays.
      await page.locator("#pfClear").click();
      await expect(page.locator("#pfResults")).toBeHidden();
      await expect(page.locator("#planCal .pc-day.pf-hit")).toHaveCount(0);
      await expect(page.locator("button.pc-slot.filled")).toHaveCount(1);
    });
  }

  test("a show that is already in the plan asks before it is added a second time", async ({ page }) => {
    test.skip(!LOCAL, "needs the sample schedule, where the same show plays every day");
    await openPlanner(page);
    await page.locator("#pfInput").fill("wicked");
    await expect(times(page)).toHaveCount(6);
    await times(page).nth(0).click();
    await expect(page.locator("button.pc-slot.filled")).toHaveCount(1);
    await times(page).nth(2).click(); // the next day's matinee
    await expect(page.locator("#duplicateOverlay")).toBeVisible();
    await page.locator("#duplicateYes").click();
    await expect(page.locator("button.pc-slot.filled")).toHaveCount(2);
    await expect(page.locator("#pfResults button.pf-time.on")).toHaveCount(2);
  });

  test("a play is found while plays are switched off, with one button to switch them on", async ({ page }) => {
    test.skip(!LOCAL, "needs the sample schedule, which has one play");
    await openPlanner(page);
    await page.locator("#pfInput").fill("mousetrap");
    await expect(found(page)).toHaveCount(1);
    await expect(found(page)).toContainText("The Mousetrap");
    await expect(page.locator("#pfResults .pf-note")).toContainText("“Plays” is switched off");
    await expect(times(page)).toHaveCount(3);
    for (const b of await times(page).all()) await expect(b).toBeDisabled();
    await expect(page.locator("#planCal .pc-day.pf-hit")).toHaveCount(0); // not on the calendar yet, so nothing to outline
    await page.locator("#pfResults button.pf-on").click();
    await expect(page.locator("#planCal .pc-day.pf-hit")).toHaveCount(3);
    await expect(page.locator("#pfResults .pf-note")).toHaveCount(0);
    await expect(times(page).first()).toBeEnabled();
    await times(page).first().click();
    await expect(page.locator("button.pc-slot.filled")).toContainText("The Mousetrap");
  });

  test("a show unticked in the filter is found, with one button to tick it back", async ({ page }) => {
    test.skip(!LOCAL, "needs the sample schedule");
    await openPlanner(page);
    await page.evaluate(() => { state.excluded[state.city].add("Hamilton"); save(); renderSidebar(); renderDay(); });
    await page.locator("#pfInput").fill("hamiltn"); // with a typing slip
    await expect(found(page)).toContainText("Hamilton");
    await expect(page.locator("#pfResults .pf-note")).toContainText("unticked this show");
    await expect(times(page).first()).toBeDisabled();
    await page.locator("#pfResults button.pf-tick").click();
    await expect(page.locator("#pfResults .pf-note")).toHaveCount(0);
    await expect(times(page).first()).toBeEnabled();
    expect(await page.evaluate(() => state.excluded[state.city].has("Hamilton"))).toBe(false);
  });

  test("a show that is not on these dates, in the other city, or unknown gets a clear answer", async ({ page }) => {
    test.skip(!LOCAL, "needs the sample schedule, which has only four London shows");
    await openPlanner(page);
    const msg = page.locator("#pfResults .pf-msg");
    await page.locator("#pfInput").fill("phantom");
    await expect(msg).toContainText("The Phantom of the Opera has no performances listed on your dates");
    await expect(msg.locator('a[href="/london/the-phantom-of-the-opera/"]')).toBeVisible();
    await page.locator("#pfInput").fill("aladdin");
    await expect(msg).toContainText("Aladdin plays in New York; this plan is for London");
    await expect(msg.locator('a[href="/new-york/aladdin/"]')).toBeVisible();
    await page.locator("#pfInput").fill("zzqqxx");
    await expect(msg).toContainText("No show called “zzqqxx”");
    await expect(found(page)).toHaveCount(0);
    // "change your dates" opens the date screen.
    await page.locator("#pfInput").fill("phantom");
    await page.locator("#pfDates").click();
    await expect(page.locator("#continueBtn")).toBeVisible();
  });
});

test.describe("search counting", () => {
  test("the counter accepts a search, and keeps only plain words of a name that found nothing", () => {
    test.skip(!LOCAL, CODE_ONLY);
    const r = inSite(`import { normalizeEvent } from "./lib/events.js"; import { yesterdayLines } from "./lib/daily-report.js";
      const found = normalizeEvent({ event: "show_search", page: "/london/", city: "london", show: "Wicked" });
      const none = normalizeEvent({ event: "show_search_none", page: "/", city: "", show: "  Cats <b>2027</b> me@example.com and a very long tail of words that goes on and on" });
      const day = "2026-11-21";
      const lines = yesterdayLines({ date: "2026-11-22T04:00:00Z", site: { recent: { events: [{ day, event: "pageview", n: 10, visitors: 5 }], referrers: [], goShows: [],
        searches: [{ day, event: "show_search", show: "Wicked", n: 3 }, { day, event: "show_search", show: "Hamilton", n: 1 }, { day, event: "show_search_none", show: "cats", n: 2 }, { day: "2026-11-20", event: "show_search_none", show: "old", n: 9 }] } } });
      const quiet = yesterdayLines({ date: "2026-11-22T04:00:00Z", site: { recent: { events: [], referrers: [], goShows: [] } } });
      console.log(JSON.stringify({ found, none, lines, quiet }));`);
    expect(r.found).toMatchObject({ event: "show_search", show: "Wicked", city: "london" });
    expect(r.none.show).toMatch(/^[a-z0-9 ]{1,40}$/);
    expect(r.none.show.startsWith("cats b 2027 b me example com")).toBe(true);
    expect(r.lines).toContain("Shows found with the search box: Wicked 3 · Hamilton 1.");
    expect(r.lines).toContain("Searched for but not in the guide: cats 2.");
    expect(r.quiet.join(" ")).not.toMatch(/search/i);
  });
});
