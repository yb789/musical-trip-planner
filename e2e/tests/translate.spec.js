// Browser page translation (Chrome / Safari / Edge "Translate this page") must leave proper names
// alone: show titles, theatre names, seller names and prices carry translate="no", while the
// labels around them stay translatable. A real translation can't be run in a test, so these check
// the mark the browsers obey. The planner's marks come from patch-translate-no.mjs.
import { test, expect, tripDates, LOCAL } from "./fixtures.js";

const CITIES = [
  { key: "london", slug: "london", startButton: "London · West End", area: "West End" },
  { key: "broadway", slug: "new-york", startButton: "New York · Broadway", area: "Broadway" },
];
const SCHEDULE_WAIT = LOCAL ? 15_000 : 150_000;
test.describe.configure({ timeout: LOCAL ? 60_000 : 360_000 });

// Same steps as planner.spec.js: start screen -> planner with a 3-day trip and the schedule loaded.
async function openPlanner(page, city) {
  await page.goto("/");
  await page.getByRole("button", { name: city.startButton, exact: true }).click();
  await page.locator("button.mh-card:not(.mh-feature)").click();
  await expect(page.locator("#continueBtn")).toContainText(city.area);
  const { start, end } = tripDates();
  if (start.getMonth() !== new Date().getMonth()) await page.locator("#pickerNext").click();
  const day = n => page.locator("button.picker-day:not(.past-date)").filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) });
  await day(start.getDate()).click();
  await day(end.getDate()).click();
  await page.locator("#continueBtn").click();
  await expect(page.locator("button.pc-slot.empty").filter({ hasText: /Choose/ }).first()).toBeVisible({ timeout: SCHEDULE_WAIT });
}

// True when the browser will not translate this element's text.
const kept = locator => locator.evaluate(el => el.translate === false);
// True when the browser will translate it.
const translated = locator => locator.evaluate(el => el.translate === true);

for (const city of CITIES) {
  test(`${city.area} planner: names stay as written, labels can be translated`, async ({ page }) => {
    await openPlanner(page, city);

    // Choose a matinee from the list of shows.
    await page.locator("button.pc-slot.empty").filter({ hasText: "Matinee" }).filter({ hasText: /Choose/ }).first().click();
    await expect(page.locator("#pcModalTitle")).toBeVisible();
    const title = page.locator(".show-title [translate=no]").first();
    await expect(title).toBeVisible();
    expect(await kept(title), "show title in the list").toBe(true);
    const venue = page.locator(".show-venue [translate=no]").first();
    await expect(venue).toBeVisible();
    expect(await kept(venue), "theatre name in the list").toBe(true);
    // The button next to it is interface text and must still translate.
    const pick = page.locator("button.pick:not([disabled])").filter({ hasText: "Choose" }).first();
    expect(await translated(pick), "the Choose button").toBe(true);
    const name = await pick.getAttribute("data-name");
    await pick.click();
    await expect(page.locator("#pcModalTitle")).toBeHidden();

    // Calendar: the filled slot shows the name, protected; its "Matinee" label is not.
    const slot = page.locator("button.pc-slot.filled").first();
    await expect(slot).toBeVisible();
    expect(await kept(slot.locator(".pc-slot-show")), "show name in the calendar slot").toBe(true);
    expect(await translated(slot), "the slot itself").toBe(true);
    expect(name).toBeTruthy();

    // Finish: the booking checklist.
    await page.locator("#finishBtn").click();
    await page.locator("#finishYes").click();
    await expect(page.getByRole("heading", { name: "Your plan is ready" })).toBeVisible();
    const row = page.locator("li.book-row").first();
    expect(await kept(row.locator(".book-show [translate=no]").first()), "show name in the checklist").toBe(true);
    expect(await translated(row.locator(".book-when")), "date and session in the checklist").toBe(true);
    // Seller buttons: SeatPlan / Ticketmaster are names.
    const seller = row.locator("button.book-seller").filter({ hasText: /SeatPlan|Ticketmaster/ }).first();
    await expect(seller).toBeVisible();
    await expect(seller.locator("[translate=no]")).toHaveText(/^(SeatPlan|Ticketmaster)$/);

    // "Buy tickets" box: show name kept, "Continue to" translatable, and the link is still a /go link.
    await seller.click();
    await expect(page.locator("#leaveTitle")).toBeVisible();
    expect(await kept(page.locator("#leaveShow b").first()), "show name in the Buy tickets box").toBe(true);
    const link = page.locator("a.ticket-link").filter({ hasText: /^Continue to / }).first();
    await expect(link).toHaveText(/^Continue to (SeatPlan|Ticketmaster) ↗$/);
    await expect(link.locator("[translate=no]")).toHaveText(/^(SeatPlan|Ticketmaster)$/);
    expect(await translated(link), "the Continue to link").toBe(true);
    expect(new URL(await link.getAttribute("href"), page.url()).pathname).toBe("/go");
  });

  test(`${city.area} pages: show names and theatres are marked`, async ({ page }) => {
    await page.goto(`/${city.slug}/`);
    const cards = page.locator(".card h3[translate=no]");
    expect(await cards.count()).toBeGreaterThan(5);
    expect(await kept(cards.first().locator("a")), "show name on the city page").toBe(true);
    expect(await kept(page.locator(".card .muted [translate=no]").first()), "theatre on the city page").toBe(true);
    // Headings and descriptions are ordinary text.
    expect(await translated(page.locator("h1")), "the city page heading").toBe(true);
    expect(await translated(page.locator(".card p").first()), "a show description").toBe(true);
  });

  test(`${city.area} show page: the title, theatre and seller name are marked`, async ({ page }) => {
    test.skip(LOCAL, "show pages read Ticketmaster live");
    await page.goto(`/${city.slug}/`);
    await page.goto(await page.locator(".card h3[translate=no] a").first().getAttribute("href"));
    expect(await kept(page.locator("h1")), "show page heading").toBe(true);
    expect(await translated(page.locator("h2").first()), "show page section heading").toBe(true);
    const sp = page.locator("a.btn.sp").filter({ hasText: "SeatPlan" });
    if (await sp.count()) await expect(sp.first().locator("[translate=no]")).toHaveText("SeatPlan");
  });
}

test("Help me choose: suggested shows are marked", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "London · West End", exact: true }).click();
  await page.locator("button.mh-card.mh-feature").click();
  for (const question of ["Who’s coming?", "What kind of night out?", "A classic, or something newer?", "How many shows are you planning to see?"]) {
    await expect(page.locator("#mhTitle")).toHaveText(question);
    await page.locator("button.mh-option").first().click();
  }
  await expect(page.locator("#mhTitle")).toContainText("Your shortlist for London");
  await expect(page.locator(".mh-show-title").first()).toBeVisible();
  expect(await kept(page.locator(".mh-show-title").first()), "suggested show title").toBe(true);
  expect(await kept(page.locator(".mh-show-venue").first()), "suggested show theatre").toBe(true);
  expect(await translated(page.locator(".mh-blurb").first()), "suggested show description").toBe(true);
});
