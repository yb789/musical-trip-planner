# Musical Trip Planner — rules for Claude sessions

Read `README.md` for the layout and `e2e/README.md` for the tests.

## Every change is tested end to end (Yuval's rule, 14 Nov 2026)

The ticket links are the most important part of the site: they are its only income. A change is
not done until the end-to-end tests have passed. In every session that changes anything in this
repository:

1. **Before opening a pull request**, run the tests on a local copy and make them pass:
   ```sh
   npm ci                         # repo root, once
   cd e2e && npm ci               # once
   E2E_LOCAL=1 npx playwright test
   ```
   In a session without Playwright's own browsers:
   `E2E_LOCAL=1 E2E_SKIP_WEBKIT=1 E2E_CHROME=/usr/bin/google-chrome npx playwright test`.
   If the tests can't be run in the session at all, say so plainly and rely on step 2.
2. **After opening the pull request**, wait for the "End-to-end tests" checks on GitHub
   (`local copy` and `deployed site`) and read their result. Do not ask Yuval to merge, and do not
   merge, while a check is failing or still running. A skipped preview run (Vercel protection) is
   not a failure.
3. **After the merge**, wait for the "End-to-end tests" run on `main`, which tests
   https://musicaltripplanner.com, and report its numbers (passed / failed / skipped). If it
   fails, say so first and fix it or propose reverting.
4. **Report honestly**: give the pass/fail counts, name what was not tested (for example a real
   iPhone), and never describe a change as working when its tests did not run.

Keep the tests in step with the site:

- A new feature, page, seller or kind of link gets a test in the same pull request.
- When a bug reaches the live site, first add a test that fails because of it, then fix it.
- If a change makes a test wrong, update the test in the same pull request and say why. Never
  delete, skip or weaken a test just to make a run pass.
- New tests import `test` and `expect` from `e2e/tests/fixtures.js`, so they keep the stub
  sellers (no affiliate clicks), the visitor-counter opt-out and the error checks.
- Tests must never open Ticketmaster, SeatPlan or Impact for real, and never buy anything.

## Working in this repository

- Changes go through a pull request. Merge only when Yuval says so.
- `node build.mjs` rewrites `index.html` in place. Don't run it in the working copy;
  `e2e/local-server.mjs` builds in a temporary folder. Never edit or commit `public/`.
- Don't commit changes to the root `package-lock.json` that only come from running `npm install`.
- Ticket links are built with `goPath()` (server) or `spTracked()` / `/api/tm-link` (browser) and
  always go through `/go`; never write an Impact address directly.
- The live site can usually not be opened from a Claude session's sandbox. The GitHub checks are
  how a session sees the live result.
