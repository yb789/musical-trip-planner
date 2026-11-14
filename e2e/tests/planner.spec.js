// The main journey, as a visitor does it: choose a city and dates, see the live schedule, pick a
// matinee and an evening, finish, go to the ticket seller, export, share — in London and in New York.
import { test, expect, reachSeller, tripDates, LOCAL } from "./fixtures.js";

const CITIES = [
  { key: "london", startButton: "London · West End", area: "West End", sellerPath: /seatplan\.com\/london\/|ticketmaster\.co\.uk/ },
  { key: "broadway", startButton: "New York · Broadway", area: "Broadway", sellerPath: /seatplan\.com\/new-york\/|ticketmaster\.com/ },
];
const SCHEDULE_WAIT = LOCAL ? 15_000 : 150_000;
test.describe.configure({ timeout: LOCAL ? 60_000 : 360_000 });

// Start screen -> planner with a 3-day trip and the schedule loaded.
async function openPlanner(page, city) {
  await page.goto("/");
  await expect(page.locator("#mhTitle")).toHaveText("Welcome to your Musical Planner");
  await page.getByRole("button", { name: city.startButton, exact: true }).click();
  await page.locator("button.mh-card:not(.mh-feature)").click();

  // Choose-dates screen: the city must be the one just picked.
  await expect(page.locator("#continueBtn")).toContainText(city.area);
  const { start, end } = tripDates();
  if (start.getMonth() !== new Date().getMonth()) await page.locator("#pickerNext").click();
  const day = n => page.locator("button.picker-day:not(.past-date)").filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) });
  await day(start.getDate()).click();
  await day(end.getDate()).click();
  await expect(page.locator("button.picker-day.range-start")).toHaveCount(1);
  await expect(page.locator("button.picker-day.in-range")).toHaveCount(3);
  await page.locator("#continueBtn").click();

  // Planner: the schedule has arrived when a slot offers shows to choose from.
  await expect(page.locator("button.pc-slot.empty").filter({ hasText: /Choose/ }).first()).toBeVisible({ timeout: SCHEDULE_WAIT });
  const trip = JSON.parse(await page.evaluate(() => localStorage.getItem("musicalPlannerTrip")));
  expect(trip.city).toBe(city.key);
  return trip;
}

// Opens an empty slot of that kind and takes a show nobody picked yet. Returns the show's name.
async function chooseShow(page, slotLabel, avoid = []) {
  const slot = page.locator("button.pc-slot.empty").filter({ hasText: slotLabel }).filter({ hasText: /Choose/ }).first();
  await slot.click(); // scrolls to it and waits out the calendar redrawing itself
  await expect(page.locator("#pcModalTitle")).toBeVisible();
  const picks = page.locator("button.pick:not([disabled])").filter({ hasText: "Choose" });
  await expect(picks.first()).toBeVisible();
  const names = await picks.evaluateAll(bs => bs.map(b => b.dataset.name));
  let index = names.findIndex(n => !avoid.includes(n));
  if (index < 0) index = 0;
  await picks.nth(index).click();
  await expect(page.locator("#pcModalTitle")).toBeHidden();
  return names[index];
}

for (const city of CITIES) {
  test.describe(`${city.area} trip`, () => {
    test("plan a matinee and an evening, finish, and reach the ticket seller", async ({ page, context }, testInfo) => {
      await openPlanner(page, city);

      const matinee = await chooseShow(page, "Matinee");
      const evening = await chooseShow(page, "Evening", [matinee]);
      await expect(page.locator("button.pc-slot.filled")).toHaveCount(2);
      await expect(page.locator("button.pc-slot.filled").filter({ hasText: matinee }).first()).toBeVisible();
      await expect(page.locator("button.pc-slot.filled").filter({ hasText: evening }).first()).toBeVisible();

      // The plan survives a reload (it is kept in the browser).
      await page.reload();
      await page.getByRole("button", { name: /^Resume my trip/ }).click();
      await expect(page.locator("button.pc-slot.filled")).toHaveCount(2, { timeout: SCHEDULE_WAIT });

      // The other view shows the same choices.
      await page.locator("#scheduleTab").click();
      await expect(page.locator("#activeDateTitle")).toBeVisible();
      await expect(page.locator("button.pick.selected").first()).toBeVisible();
      await page.locator("#planCalTab").click();

      // Finish.
      await page.locator("#finishBtn").click();
      await page.locator("#finishYes").click();
      await expect(page.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
      const sellers = page.locator("button.book-seller");
      expect(await sellers.count()).toBeGreaterThanOrEqual(2);

      // Ticket button -> "Buy tickets" dialog -> link through /go -> the seller.
      await sellers.first().click();
      await expect(page.locator("#leaveTitle")).toBeVisible();
      const link = page.locator("a.ticket-link").filter({ hasText: /^Continue to / }).first();
      const go = new URL(await link.getAttribute("href"), page.url());
      expect(go.pathname).toBe("/go");
      expect(go.searchParams.get("u")).toMatch(/^https:\/\//);
      expect(go.searchParams.get("u")).toMatch(city.sellerPath);
      expect(go.searchParams.get("subId1")).toMatch(/^[a-z0-9-]+$/);
      const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
      await link.click();
      const dest = (await popup) || page;
      const { viaContinuePage } = await reachSeller(dest);
      // Not a failure, but worth seeing in the report: a real visitor in this browser needs an extra tap.
      testInfo.annotations.push({ type: "ticket click", description: viaContinuePage ? "went through the Continue page (one extra tap)" : "went straight to the seller" });
      if (dest !== page) await dest.close();
    });

    test("mark as booked, and export to Excel, PDF and calendar", async ({ page }) => {
      await openPlanner(page, city);
      await chooseShow(page, "Matinee");
      await page.locator("#finishBtn").click();
      await page.locator("#finishYes").click();
      await expect(page.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();

      const mark = page.locator("button.book-mark").first();
      await expect(mark).toHaveText("Mark as booked");
      await mark.click();
      await expect(page.locator(".book-badge").first()).toContainText("Booked");
      await page.locator("button.book-undo").first().click();
      await expect(page.locator("button.book-mark").first()).toBeVisible();

      for (const [button, ext] of [["#excelBtn", /\.xlsx?$/], ["#pdfBtn", /\.pdf$/], ["#icsBtn", /\.ics$/]]) {
        if (LOCAL && button !== "#icsBtn") continue; // Excel and PDF load their libraries from a CDN
        const download = page.waitForEvent("download", { timeout: 60_000 });
        await page.locator(button).click();
        const file = await download;
        expect(file.suggestedFilename(), button).toMatch(ext);
        const path = await file.path();
        const { size } = await import("node:fs").then(fs => fs.statSync(path));
        expect(size, `${button} file is empty`).toBeGreaterThan(200);
      }
    });
  });
}

test("changing city on the choose-dates screen changes the planner", async ({ page }) => {
  await page.goto("/#/plan");
  await expect(page.locator("#continueBtn")).toBeVisible();
  await page.locator("button.city-card").filter({ hasText: "New York" }).click();
  await expect(page.locator("#continueBtn")).toContainText("Broadway");
  await page.locator("button.city-card").filter({ hasText: "London" }).click();
  await expect(page.locator("#continueBtn")).toContainText("West End");
});

test("share a plan: the link opens the same plan for someone else", async ({ page, browser, baseURL }, testInfo) => {
  test.skip(LOCAL, "shared plans are stored in the database");
  // One shared plan per run is enough; it is a real row in the plans table.
  test.skip(testInfo.project.name !== "desktop-chrome", "run once, on desktop");
  await openPlanner(page, CITIES[0]);
  const show = await chooseShow(page, "Evening");
  const created = page.waitForResponse(r => new URL(r.url()).pathname === "/api/plan" && r.request().method() === "POST");
  await page.locator("#shareBtn").click();
  const res = await created;
  expect([200, 201]).toContain(res.status());
  const body = await res.json();
  const code = body.code || (body.url || "").split("/").pop();
  expect(code).toMatch(/^[a-z0-9]{6}$/);

  // Someone else, in a fresh browser, opens the link.
  const other = await browser.newContext({ baseURL, serviceWorkers: "block" });
  await other.addInitScript(() => { try { localStorage.setItem("mtpNoTrack", "1"); } catch {} });
  const visitor = await other.newPage();
  const opened = await visitor.goto(`/plan/${code}`);
  expect(opened.status()).toBe(200);
  await expect(visitor.getByText(show).first()).toBeVisible();
  const ics = await visitor.request.get(`/plan/${code}/calendar.ics`);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  await other.close();
});
