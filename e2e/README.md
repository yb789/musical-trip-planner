# End-to-end tests

These tests use the site the way a visitor does, in real browsers (Chrome at desktop and phone
size, and Safari's engine at iPhone size), and fail if anything on the way breaks.

## What is covered

| File | What it checks |
|---|---|
| `tests/planner.spec.js` | London and New York: choose city and dates, live schedule loads, pick a matinee and an evening, reload keeps the plan, day-by-day view, finish, ticket button → Buy tickets → `/go` → seller, mark as booked, Excel / PDF / calendar exports, share link opens for someone else |
| `tests/go.spec.js` | The ticket redirect for Ticketmaster UK, Ticketmaster US and SeatPlan (London, New York): a person's click goes straight to the right Impact link (Chrome and Safari); a visit that is not a click gets the Continue page and its button works; crawlers never get the seller's address; other sites are refused |
| `tests/pages.spec.js` | About, terms, privacy, guides, city pages, show pages (times and ticket links), matinees pages and week picker, 404s, robots.txt, sitemap (and a sample of its pages), manifest, Android link file, service worker, icons, security headers, certificate |
| `tests/helper.spec.js` | "Help me choose": four questions, shortlist, on to the planner |

Every test also fails on a script error, a Content-Security-Policy violation, or a server error
from the site.

## What the tests never do

- **No affiliate clicks.** The browsers go through a small proxy that hands Ticketmaster, SeatPlan
  and Impact addresses to a stub page. The site's own redirects are real; only the last hop is not.
- **No visits or ticket clicks in the stats.** Every test browser is opted out (same as `?notrack=1`).
- The share test stores one small plan per run against a deployed site (not in local runs).

## When they run

Automatically (`.github/workflows/e2e.yml`):

- every pull request — a local copy with a sample schedule. The pull request's Vercel preview
  (live schedule) is tested too once the repository secret `VERCEL_AUTOMATION_BYPASS_SECRET` is
  set; until then Vercel's protection keeps the tests out and that part is skipped with a warning;
- every merge to `main` — the live site, after Vercel has deployed it.

By hand: GitHub → Actions → "End-to-end tests" → Run workflow.

When a run fails, its page on GitHub has a `playwright-report-…` artifact with a screenshot and a
step-by-step trace of each failed test.

## Running them yourself

```sh
npm ci                      # in the repo root (the local copy runs the real api/ code)
cd e2e && npm ci
npx playwright install chromium webkit

npm run test:local          # local copy, sample schedule: about a minute, needs no network
npm test                    # the live site
E2E_BASE_URL=https://<preview>.vercel.app npm test
```

Useful: `npx playwright test --project=desktop-chrome`, `-g "SeatPlan"`, `--headed`, `--ui`.
`E2E_CHROME=/usr/bin/google-chrome E2E_SKIP_WEBKIT=1` uses an installed Chrome and skips Safari.

The local copy (`local-server.mjs`) builds the site in a temporary folder and serves it with the
rewrites and headers from `vercel.json`. It has no database and no access to the ticket sites, so
with `E2E_LOCAL=1` the tests use a sample schedule and skip show pages, matinees pages and sharing.

## Adding a test

Import `test` and `expect` from `./fixtures.js` (not from `@playwright/test`), so the new test gets
the stub sellers, the opt-out and the error checks. Add a test whenever a bug reaches the live site:
first make it fail, then fix the bug.
