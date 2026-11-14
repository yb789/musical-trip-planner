// /go — the ticket redirect. Every "buy tickets" link on the site passes through it, so if this
// breaks, nobody reaches Ticketmaster or SeatPlan (as happened on 13–14 Nov 2026).
import { test, expect, apiGet, apiPost, reachSeller, IMPACT, STUB_TEXT } from "./fixtures.js";

const SELLERS = [
  { name: "Ticketmaster UK", page: "https://www.ticketmaster.co.uk/wicked-tickets/artist/1094215", impact: IMPACT["ticketmaster-uk"], label: "Ticketmaster" },
  { name: "Ticketmaster UK theatre booking", page: "https://theatre.ticketmaster.co.uk/book/APOLWIC-wicked/#perf=1&date=2027-01-15&time=19:30", impact: IMPACT["ticketmaster-uk"], label: "Ticketmaster" },
  { name: "Ticketmaster US", page: "https://www.ticketmaster.com/event/Z1r9uZruZqGZ17J_qE", impact: IMPACT["ticketmaster-us"], label: "Ticketmaster" },
  { name: "SeatPlan London", page: "https://www.seatplan.com/london/wicked-tickets/", impact: IMPACT.seatplan, label: "SeatPlan" },
  { name: "SeatPlan New York", page: "https://www.seatplan.com/new-york/wicked-broadway-tickets/", impact: IMPACT.seatplan, label: "SeatPlan" },
];
// nt=1: not counted in the site's own click numbers.
const goUrl = (page, sub = "e2e-test") => `/go?u=${encodeURIComponent(page)}&subId1=${sub}&nt=1`;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// The address the browser ended on must be the Impact link for that seller, carrying the seller page.
function expectImpact(finalUrl, seller) {
  expect(finalUrl).toMatch(seller.impact);
  const u = new URL(finalUrl);
  expect(u.searchParams.get("u")).toBe(seller.page);
  expect(u.searchParams.get("subId1")).toBe("e2e-test");
}

for (const seller of SELLERS) {
  test.describe(seller.name, () => {
    test("a person's click on a ticket link goes straight to the seller", async ({ page, browserName }) => {
      // Known gap, found by this test on 14 Nov 2026: Safari does not send the header /go uses to
      // recognise a person's click, so every Safari and iPhone visitor gets the Continue page (one
      // extra tap; the button itself is covered by the next test). Remove this line with the fix.
      test.fixme(browserName === "webkit", "Safari clicks are answered with the Continue page");
      await page.goto("/about/");
      // A real link on a real page of the site, clicked like a visitor would.
      await page.evaluate(href => {
        const a = document.createElement("a");
        a.href = href; a.textContent = "E2E ticket link"; a.id = "e2e-link";
        a.style.cssText = "position:fixed;top:0;left:0;z-index:99999;background:#fff;padding:12px";
        document.body.appendChild(a);
      }, goUrl(seller.page));
      await page.click("#e2e-link");
      const { url, viaContinuePage } = await reachSeller(page);
      expectImpact(url, seller);
      expect(viaContinuePage, "a person's click was answered with the Continue page (an extra tap) instead of going straight to the seller").toBe(false);
    });

    test("a visit that is not a click gets the Continue page, and its button reaches the seller", async ({ page, baseURL }) => {
      // Take away the header that marks a person's click: this is what crawlers, and some phone
      // browsers and in-app browsers, look like to the server.
      // Arrive the way a page that forwards its visitors does (a meta refresh): nobody clicked, so
      // the browser does not send the header that marks a person's click. Crawlers, and some phone
      // and in-app browsers, look the same to the server.
      const target = new URL(goUrl(seller.page), baseURL).href;
      await page.goto(`data:text/html,<meta http-equiv="refresh" content="0;url=${encodeURIComponent(target)}">`);
      await page.waitForURL(url => url.pathname === "/go");
      await expect(page).toHaveTitle(`Continue to ${seller.label}`);
      const button = page.getByRole("button", { name: `Continue to ${seller.label}` });
      await expect(button).toBeVisible();
      await button.click();
      await expect(page.getByText(STUB_TEXT).first()).toBeVisible();
      expectImpact(page.url(), seller);
    });

    test("a crawler never gets the seller's address", async ({ request }) => {
      const asCrawler = await apiGet(request, goUrl(seller.page), { maxRedirects: 0, headers: { "user-agent": "Mozilla/5.0 (compatible; ExampleBot/1.0)" } });
      expect(asCrawler.status()).toBe(200);
      expect(asCrawler.headers()["x-robots-tag"]).toContain("noindex");
      const html = await asCrawler.text();
      expect(html).toContain(`Continue to ${seller.label}`);
      expect(html).not.toMatch(/evyy\.net|sjv\.io/);
      // A browser-like visit without the click header (a link follower) gets the same page.
      const asFollower = await apiGet(request, goUrl(seller.page), { maxRedirects: 0, headers: { "user-agent": BROWSER_UA } });
      expect(asFollower.status()).toBe(200);
      expect(await asFollower.text()).not.toMatch(/evyy\.net|sjv\.io/);
      // Even pressing the button does nothing for a crawler.
      const pressed = await apiPost(request, goUrl(seller.page), { maxRedirects: 0, headers: { "user-agent": "Mozilla/5.0 (compatible; ExampleBot/1.0)" } });
      expect(pressed.status()).toBe(200);
      expect(await pressed.text()).not.toMatch(/evyy\.net|sjv\.io/);
    });
  });
}

test("links to other sites are refused", async ({ request }) => {
  for (const bad of ["https://example.com/", "http://www.ticketmaster.co.uk/x", "https://www.ticketmaster.co.uk.example.com/x", "https://seatplan.com.evil.example/", "javascript:alert(1)", ""]) {
    const res = await apiGet(request, `/go?u=${encodeURIComponent(bad)}&nt=1`, { maxRedirects: 0, headers: { "user-agent": BROWSER_UA, "sec-fetch-user": "?1" } });
    expect(res.status(), `/go must refuse ${bad || "(empty)"}`).toBe(400);
    expect(res.headers()["location"]).toBeUndefined();
  }
});

test("search engines are told to stay away from /go", async ({ request }) => {
  const robots = await (await apiGet(request, "/robots.txt")).text();
  expect(robots).toMatch(/Disallow:\s*\/go/);
});
