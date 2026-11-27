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
      const html = await renderShow("london", "wicked", { fetchImpl, now });
      const box = (html.match(/<section class="card nexttix"[\\s\\S]*?<\\/section>/) || [""])[0];
      const evOnly = nextPerformances([{ date: "2026-11-28", time: "19:30", url: "https://www.ticketmaster.co.uk/x", status: "onsale" }], now);
      const none = nextPerformances([{ date: "2026-11-26", time: "19:30", url: "https://www.ticketmaster.co.uk/x", status: "onsale" }], now);
      console.log(JSON.stringify({ box, boxFirst: html.indexOf("nexttix") < html.indexOf('class="pills"'), oldButton: html.includes('class="btn tix" href="#dates"'), evOnly, none }));`);
    // The box is there, above the show's description.
    expect(r.box).toContain("Next performances");
    expect(r.boxFirst).toBe(true);
    // The performance that has already started and the cancelled one are skipped.
    expect(r.box).toContain("Next matinee");
    expect(r.box).toContain("Sat 28 Nov · 2:30 pm");
    expect(r.box).toContain("Sat 28 Nov · 7:30 pm");
    expect(r.box).not.toContain("27 Nov");
    expect(r.box).toContain("Tickets from £29");
    expect(r.box).toContain("Tickets from £35");
    expect(r.box).toContain("ends about 5:15 pm");
    // Every ticket button goes through /go to the seller page of that performance, tagged top-<show>.
    const hrefs = [...r.box.matchAll(/class="btn tix" href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, "&"));
    expect(hrefs).toHaveLength(2);
    for (const h of hrefs) {
      const u = new URL(h, "https://musicaltripplanner.com");
      expect(u.pathname).toBe("/go");
      expect(new URL(u.searchParams.get("u")).hostname).toBe("www.ticketmaster.co.uk");
      expect(u.searchParams.get("subId1")).toBe("top-wicked");
    }
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
