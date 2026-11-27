// Ticket box at the top of every show page (27 Nov 2026): the next matinee and the next evening,
// each with its price and a direct ticket button through /go, and the planner as the second step.
// Most ticket clicks come from show pages, so this box is the first thing a visitor sees.
//
// The first test renders a show page from the site's code with a made-up Ticketmaster answer (local
// copy only: show pages read Ticketmaster live). The second opens real show pages on the deployed
// site and follows a box button to the seller (the stub, never the real seller).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, reachSeller, LOCAL } from "./fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const inSite = code => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const CODE_ONLY = "checks the site's code; runs with the local copy, where the site's packages are installed";

test.describe("show-page ticket box", () => {
  test("shows the next matinee and evening with /go ticket buttons", () => {
    test.skip(!LOCAL, CODE_ONLY);
    const r = inSite(`import { renderShow, nextPerformances } from "./lib/site-pages.js";
      process.env.TICKETMASTER_API_KEY = "test";
      const now = Date.parse("2026-11-27T10:00:00Z");
      const ev = (date, time, status = "onsale", price = 0) => ({ name: "Wicked",
        url: "https://www.ticketmaster.co.uk/wicked/event/" + date + time.replace(":", ""),
        dates: { start: { localDate: date, localTime: time + ":00", dateTime: date + "T" + time + ":00Z" }, status: { code: status } },
        priceRanges: price ? [{ min: price, currency: "GBP" }] : [],
        _embedded: { venues: [{ name: "Apollo Victoria Theatre", city: { name: "London" } }] } });
      const events = [ev("2026-11-27", "09:30"), ev("2026-11-27", "19:30", "cancelled"), ev("2026-11-28", "14:30", "onsale", 29), ev("2026-11-28", "19:30", "onsale", 35)];
      const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ _embedded: { events } }) });
      const html = await renderShow("london", "wicked", { fetchImpl, now, seatPlanPage: "https://seatplan.com/london/wicked-tickets/" });
      const noSp = await renderShow("london", "wicked", { fetchImpl, now, seatPlanPage: null });
      const noSpBox = (noSp.match(/<section class="card nexttix"[\\s\\S]*?<\\/section>/) || [""])[0];
      const box = (html.match(/<section class="card nexttix"[\\s\\S]*?<\\/section>/) || [""])[0];
      const evOnly = nextPerformances([{ date: "2026-11-28", time: "19:30", url: "https://www.ticketmaster.co.uk/x", status: "onsale" }], now);
      const none = nextPerformances([{ date: "2026-11-26", time: "19:30", url: "https://www.ticketmaster.co.uk/x", status: "onsale" }], now);
      const dates = (html.match(/<div class="card" id="dates">[\\s\\S]*?<\\/table>/) || [""])[0];
      console.log(JSON.stringify({ box, noSpBox, dates, boxFirst: html.indexOf("nexttix") < html.indexOf('class="pills"'), oldButton: html.includes('class="btn tix" href="#dates"'), evOnly, none }));`);
    // The box is there, above the show's description.
    expect(r.box).toContain("Next performances");
    expect(r.boxFirst).toBe(true);
    // The performance that has already started and the cancelled one are skipped.
    expect(r.box).toContain("Next matinee");
    expect(r.box).toContain("Sat 28 Nov · 2:30 pm");
    expect(r.box).toContain("Sat 28 Nov · 7:30 pm");
    expect(r.box).not.toContain("27 Nov");
    // The price sits above the buttons with its seller named; the buttons carry no price.
    // "Tickets from £X" in big type above both buttons, with where the price was seen (27 Nov 2026).
    expect(r.box).toContain('<span class="from">Tickets from £29<small>lowest price seen on Ticketmaster</small></span>');
    expect(r.box).toContain('<span class="from">Tickets from £35<small>lowest price seen on Ticketmaster</small></span>');
    expect(r.box).toContain("ends about 5:15 pm");
    // Each slot: Ticketmaster and SeatPlan buttons of the same kind (27 Nov 2026, Yuval: "the same"),
    // both through /go, tagged top-<show>, each to that performance's page with that seller.
    const buttons = [...r.box.matchAll(/<a class="btn tix (tm|sp)" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m => ({ cls: m[1], href: m[2].replace(/&amp;/g, "&"), text: m[3] }));
    expect(buttons.map(b => b.text)).toEqual(["Ticketmaster ↗", "SeatPlan ↗", "Ticketmaster ↗", "SeatPlan ↗"]);
    // Each seller its own colour (Yuval, 27 Nov): Ticketmaster blue (class tm), SeatPlan dark red (sp).
    expect(buttons.map(b => b.cls)).toEqual(["tm", "sp", "tm", "sp"]);
    const sellerPages = buttons.map(b => {
      const u = new URL(b.href, "https://musicaltripplanner.com");
      expect(u.pathname).toBe("/go");
      expect(u.searchParams.get("subId1")).toBe("top-wicked");
      return u.searchParams.get("u");
    });
    expect(sellerPages).toEqual([
      "https://www.ticketmaster.co.uk/wicked/event/2026-11-281430",
      "https://seatplan.com/london/wicked-tickets/tickets/28-nov-2026/2-30pm/",
      "https://www.ticketmaster.co.uk/wicked/event/2026-11-281930",
      "https://seatplan.com/london/wicked-tickets/tickets/28-nov-2026/7-30pm/",
    ]);
    // The cancelled 7:30 pm on 27 Nov stays in the table, marked, with no ticket buttons.
    expect(r.dates).toContain('<span class="tt">7:30 pm</span><span class="end">cancelled</span>');
    // The dates table: under every bookable time, Ticketmaster and SeatPlan for that performance, in the same
    // colours (27 Nov 2026: tapping a time always went to Ticketmaster).
    const chips = [...r.dates.matchAll(/<a class="chip (tm|sp)" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(m => ({ cls: m[1], u: new URL(m[2].replace(/&amp;/g, "&"), "https://musicaltripplanner.com"), text: m[3] }));
    expect(chips.map(c => c.text)).toEqual(["Ticketmaster", "SeatPlan", "Ticketmaster", "SeatPlan", "Ticketmaster", "SeatPlan"]);
    expect(chips.map(c => c.cls)).toEqual(["tm", "sp", "tm", "sp", "tm", "sp"]);
    for (const c of chips) {
      expect(c.u.pathname).toBe("/go");
      expect(c.u.searchParams.get("subId1")).toBe("show-wicked");
    }
    expect(chips.filter(c => c.cls === "sp").map(c => c.u.searchParams.get("u"))).toEqual([
      "https://seatplan.com/london/wicked-tickets/tickets/27-nov-2026/9-30am/",
      "https://seatplan.com/london/wicked-tickets/tickets/28-nov-2026/2-30pm/",
      "https://seatplan.com/london/wicked-tickets/tickets/28-nov-2026/7-30pm/",
    ]);
    // A show SeatPlan doesn't list: Ticketmaster alone.
    expect([...r.noSpBox.matchAll(/class="btn tix tm"/g)]).toHaveLength(2);
    expect(r.noSpBox).not.toContain("SeatPlan");
    expect(r.box).toMatch(/rel="noopener nofollow sponsored"/);
    // The planner is the second step, inside the box.
    expect(r.box).toContain('href="/?city=london&amp;show=wicked#/plan"');
    // The old "choose a date" button is replaced by the box.
    expect(r.oldButton).toBe(false);
    // Only evenings left: no matinee; nothing left: no box.
    expect(r.evOnly.matinee).toBeNull();
    expect(r.evOnly.evening.time).toBe("19:30");
    expect(r.none).toEqual({ matinee: null, evening: null });
  });

  test("a box button on a live show page reaches the seller", async ({ page, context }) => {
    test.skip(LOCAL, "show pages read Ticketmaster live");
    // Not every show has bookable performances listed on a given day, so look through a few.
    let button = null;
    for (const href of ["/london/wicked/", "/new-york/wicked/", "/london/les-mis-rables/", "/new-york/hamilton/", "/london/hamilton/"]) {
      const res = await page.goto(href);
      if (res.status() !== 200) continue;
      const box = page.locator("#nextTickets");
      if (!(await box.count())) continue;
      // The box comes before the show's description.
      const order = await page.evaluate(() => {
        const b = document.getElementById("nextTickets"), d = document.querySelector("main .pills");
        return !d || !!(b.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(order, `${href}: the ticket box is not above the description`).toBe(true);
      await expect(box.locator('a[href*="#/plan"]')).toBeVisible();
      button = box.locator('a.btn.tix[href^="/go?"]').first();
      break;
    }
    expect(button, "no show page with a ticket box among the samples").not.toBeNull();
    // Where SeatPlan lists the show, its button opens the same performance on SeatPlan.
    const spButton = page.locator('#nextTickets a.btn.tix', { hasText: "SeatPlan" }).first();
    if (await spButton.count()) {
      const sp = new URL(new URL(await spButton.getAttribute("href"), page.url()).searchParams.get("u"));
      expect(sp.hostname).toBe("seatplan.com");
      expect(sp.pathname).toMatch(/-tickets\/tickets\/\d{1,2}-[a-z]{3}-\d{4}\/\d{1,2}-\d{2}(am|pm)\/$/);
    }
    if (await spButton.count()) {
      // Ticketmaster blue, SeatPlan a different colour.
      const bg = l => l.evaluate(el => getComputedStyle(el).backgroundColor);
      const tmButton = page.locator("#nextTickets a.btn.tix", { hasText: "Ticketmaster" }).first();
      expect(await bg(tmButton)).toBe("rgb(2, 77, 223)");
      expect(await bg(spButton)).not.toBe(await bg(tmButton));
    }
    const target = new URL(await button.getAttribute("href"), page.url());
    expect(target.searchParams.get("subId1")).toMatch(/^top-[a-z0-9-]+$/);
    expect(new URL(target.searchParams.get("u")).hostname).toMatch(/(^|\.)(ticketmaster\.com|ticketmaster\.co\.uk|seatplan\.com)$/);
    const popup = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);
    await button.evaluate(el => el.scrollIntoView({ block: "center" }));
    await button.click();
    const dest = await popup;
    expect(dest, "the ticket button opened nothing").not.toBeNull();
    const { viaContinuePage } = await reachSeller(dest);
    expect(viaContinuePage, "the ticket button got the Continue page instead of going straight to the seller").toBe(false);
  });
});
