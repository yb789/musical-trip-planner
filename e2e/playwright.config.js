// End-to-end tests for musicaltripplanner.com. See e2e/README.md.
//   E2E_BASE_URL=https://…   test a deployed copy (a Vercel preview, or production)
//   E2E_LOCAL=1              test a local copy (e2e/local-server.mjs) with a sample schedule
import { defineConfig, devices } from "@playwright/test";

const LOCAL = process.env.E2E_LOCAL === "1";
const PORT = Number(process.env.E2E_PORT || 8787);
const baseURL = (process.env.E2E_BASE_URL || (LOCAL ? `http://127.0.0.1:${PORT}` : "https://musicaltripplanner.com")).replace(/\/+$/, "");
// E2E_CHROME=/path/to/chrome uses an installed Chrome instead of Playwright's download.
const chrome = process.env.E2E_CHROME ? { launchOptions: { executablePath: process.env.E2E_CHROME} } : {};

const projects = [
  { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], ...chrome } },
  { name: "phone-chrome", use: { ...devices["Pixel 7"], ...chrome } },
];
// Safari's engine, at iPhone size. Needs `npx playwright install webkit` (done in CI).
if (process.env.E2E_SKIP_WEBKIT !== "1") projects.push({ name: "iphone-safari", use: { ...devices["iPhone 14"] } });

export default defineConfig({
  testDir: "./tests",
  timeout: LOCAL ? 60_000 : 240_000, // the live schedule can take over a minute on a cold start
  expect: { timeout: LOCAL ? 10_000 : 20_000 },
  fullyParallel: true,
  workers: LOCAL ? 4 : 3,
  retries: process.env.CI && !LOCAL ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    serviceWorkers: "block", // the offline cache would hide what the server really returns
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects,
  webServer: LOCAL ? { command: `node local-server.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/robots.txt`, reuseExistingServer: !process.env.CI, timeout: 120_000 } : undefined,
});
