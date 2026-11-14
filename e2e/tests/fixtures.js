// Shared set-up for every test:
//  - the browser is opted out of the site's visitor counter (same switch as ?notrack=1), so test
//    runs never show up in the daily stats, and /go ticket links carry nt=1;
//  - nothing ever reaches the ticket sellers or Impact, so the tests create no affiliate clicks:
//    the browser goes through a small proxy that hands those addresses to a stub page (see
//    sellerStub below). Everything else, including the redirect from /go, is the real thing;
//  - every test fails if a page throws a script error, breaks the Content-Security-Policy, or gets
//    a server error from the site itself.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { test as base, expect } from "@playwright/test";
import { sampleSchedule } from "./sample-schedule.js";

export const LOCAL = process.env.E2E_LOCAL === "1";
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
// Vercel "Protection Bypass for Automation": lets the tests open a protected preview deployment.
export const bypassHeaders = BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {};

// Where a ticket click must end up: the Impact tracking links, or (never expected) the sellers themselves.
export const SELLER_HOST = /(^|\.)(evyy\.net|sjv\.io|ticketmaster\.com|ticketmaster\.co\.uk|seatplan\.com)$/;
export const IMPACT = {
  "ticketmaster-uk": /^https:\/\/ticketmaster\.evyy\.net\/c\/7761524\/1965662\/24023\?/,
  "ticketmaster-us": /^https:\/\/ticketmaster\.evyy\.net\/c\/7761524\/264167\/4272\?/,
  seatplan: /^https:\/\/seatplan\.sjv\.io\/c\/7761524\/2219054\/28679\?/,
};
export const STUB_TEXT = "E2E seller stub";

// Requests to the site itself that may fail without it being a fault of the page under test.
const IGNORED = LOCAL
  ? [/\/_vercel\//, /\/api\/event\b/, /\/api\/tm-link\b/, /\/api\/plan\b/, /\/api\/feedback\b/, /\/icons\//, /\/api\/og\b/]
  : [/\/_vercel\//];

const stubPage = `<!doctype html><title>${STUB_TEXT}</title><h1>${STUB_TEXT}</h1>`;

export const test = base.extend({
  // Stand-in for the sellers. Two small servers per worker:
  //  - an https server that answers every request with the stub page (throw-away certificate);
  //  - a proxy the browser is told to use, which connects seller and Impact addresses to that
  //    server and everything else to where it really belongs.
  // The browser therefore follows the site's real redirects and applies its real rules (for
  // example the Content-Security-Policy), and still shows the seller's address at the end.
  sellerStub: [async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-stub-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", "/CN=e2e-seller-stub",
      "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
    const stub = https.createServer({ key: fs.readFileSync(path.join(dir, "key.pem")), cert: fs.readFileSync(path.join(dir, "cert.pem")) }, (req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(stubPage);
    });
    await new Promise(ok => stub.listen(0, "127.0.0.1", ok));
    const proxy = http.createServer((req, res) => { res.statusCode = 502; res.end("The test proxy only carries https."); });
    const sockets = new Set(); // tunnels stay open after the tests; close them ourselves at the end
    proxy.on("connect", (req, client, head) => {
      const [host, port] = req.url.split(":");
      const upstream = SELLER_HOST.test(host) ? net.connect(stub.address().port, "127.0.0.1") : net.connect(Number(port) || 443, host);
      upstream.on("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head?.length) upstream.write(head);
        upstream.pipe(client); client.pipe(upstream);
      });
      const close = () => { upstream.destroy(); client.destroy(); sockets.delete(upstream); sockets.delete(client); };
      sockets.add(upstream); sockets.add(client);
      for (const s of [upstream, client]) { s.on("error", close); s.on("close", close); }
    });
    await new Promise(ok => proxy.listen(0, "127.0.0.1", ok));
    await use({ proxy: `http://127.0.0.1:${proxy.address().port}` });
    for (const s of sockets) s.destroy();
    proxy.closeAllConnections?.(); stub.closeAllConnections?.();
    await Promise.all([new Promise(ok => proxy.close(ok)), new Promise(ok => stub.close(ok))]);
    fs.rmSync(dir, { recursive: true, force: true });
  }, { scope: "worker" }],

  proxy: async ({ sellerStub }, use) => use({ server: sellerStub.proxy, bypass: "127.0.0.1,localhost" }),
  // For the stub's throw-away certificate. The site's own certificate is checked in pages.spec.js.
  ignoreHTTPSErrors: true,

  context: async ({ context, baseURL }, use) => {
    await context.addInitScript(() => {
      try { localStorage.setItem("mtpNoTrack", "1"); } catch {}
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", e => window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`));
    });
    if (LOCAL) {
      await context.route("**/api/schedule?**", route => {
        const q = new URL(route.request().url()).searchParams;
        return route.fulfill({ json: sampleSchedule(q.get("city"), q.get("start"), q.get("end")) });
      });
    }
    if (BYPASS) await context.request.get(baseURL + "/robots.txt", { headers: { ...bypassHeaders, "x-vercel-set-bypass-cookie": "true" } });
    await use(context);
  },

  // Collects problems on every page of the test (pop-ups included) and fails the test if there are any.
  problems: [async ({ context, baseURL }, use, testInfo) => {
    const problems = [];
    const origin = new URL(baseURL).origin;
    const watch = page => {
      page.on("pageerror", err => problems.push(`script error on ${page.url()}: ${err.message}`));
      page.on("response", res => {
        const url = res.url();
        if (!url.startsWith(origin) || res.status() < 500 || IGNORED.some(re => re.test(url))) return;
        problems.push(`${res.status()} from ${url}`);
      });
      page.on("console", msg => {
        if (msg.type() === "error" && /Content Security Policy|Content-Security-Policy/i.test(msg.text())) problems.push(`CSP: ${msg.text().slice(0, 300)}`);
      });
    };
    context.pages().forEach(watch);
    context.on("page", watch);
    await use(problems);
    for (const page of context.pages()) {
      const v = await page.evaluate(() => window.__cspViolations || []).catch(() => []);
      v.forEach(x => problems.push(`CSP on ${page.url()}: ${x}`));
    }
    expect.soft([...new Set(problems)], "problems seen while the test ran").toEqual([]);
  }, { auto: true }],
});

export { expect };

// GET/POST with the API client (no browser), sending the preview-protection header when configured.
export const apiGet = (request, url, options = {}) => request.get(url, { ...options, headers: { ...bypassHeaders, ...(options.headers || {}) } });
export const apiPost = (request, url, options = {}) => request.post(url, { ...options, headers: { ...bypassHeaders, ...(options.headers || {}) } });

// A ticket link may answer with the "Continue to <seller>" page first; press its button if so.
// Ends on the seller stub or fails. Returns { url: the seller address, viaContinuePage }.
export async function reachSeller(dest) {
  const stub = dest.getByText(STUB_TEXT).first();
  const button = dest.getByRole("button", { name: /^Continue to / });
  await expect(stub.or(button).first()).toBeVisible();
  const viaContinuePage = await button.isVisible().catch(() => false);
  if (viaContinuePage) await button.click();
  await expect(stub).toBeVisible();
  const url = dest.url();
  expect(SELLER_HOST.test(new URL(url).hostname), `ended on ${url}`).toBe(true);
  return { url, viaContinuePage };
}

// Three days in one calendar month, 10+ days ahead (far enough to have a full schedule, near
// enough for every source). Returns Date objects in local time.
export function tripDates() {
  const start = new Date(); start.setHours(12, 0, 0, 0); start.setDate(start.getDate() + 10);
  const end = new Date(start); end.setDate(end.getDate() + 2);
  if (end.getMonth() !== start.getMonth()) { start.setMonth(start.getMonth() + 1, 2); end.setTime(start.getTime()); end.setDate(end.getDate() + 2); }
  return { start, end };
}
