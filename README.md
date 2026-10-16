# Musical Trip Planner

Plan a West End or Broadway trip: pick dates, see which musicals play when, choose one matinee and one evening per day, then export (Excel/PDF) or share a link. Live at **https://musicaltripplanner.com**.

## Where the documentation lives

The repository deliberately carries no handoff document. The up-to-date project notes, decisions and release write-ups live outside the code:

- **Project notes (Claude project "musical planner")** — release notes, security review, revenue and exposure plans, data reviews.
- **Obsidian vault (Dropbox)** — `general/apps/Musical Trip Planner - AI Handoff.md`, the long-form handoff.

The two `AI_HANDOFF*.md` files that used to sit here were snapshots from September 2026 and had drifted from the code; they were removed on 16 Oct 2026. Use `git log` and the pull-request descriptions for the history of each change.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `*.js`, `*.css` | Source of the single-page planner. **Do not edit `public/`** — it is generated. |
| `patch-*.mjs`, `build.mjs` | Build-time patches assembled into `public/index.html` (`node build.mjs`). Order matters; each patch asserts the text it replaces. |
| `api/` | Vercel serverless functions: `schedule` (live London/Broadway timetables), `plan` + `plan-page` (shared itineraries, Neon Postgres), `pages` (show, city, matinee, guide and about pages), `og` (social images), `tm-link` (Ticketmaster affiliate links), `feedback`, `guide-check` (weekly cron). |
| `lib/` | Shared server code: scrapers, SeatPlan matching, page renderers, plan storage. |
| `data/shows-*.json` | The show guide: titles, venues, dates, runtime, blurbs, tags. |
| `static/` | Files copied to `public/` as-is (robots, sitemap, manifest, favicon). |
| `vercel.json` | Rewrites for the pretty URLs, security headers, function settings, cron. |

## Running and deploying

- `npm ci && node build.mjs` builds `public/`. Vercel runs the same command on every push; pull-request branches get a preview URL.
- Environment variables on Vercel: `DATABASE_URL` (Neon: shared plans and feedback), `RESEND_API_KEY`, `FEEDBACK_TO`, `FEEDBACK_FROM`, `FEEDBACK_SALT` (feedback form and guide-check emails), `TICKETMASTER_API_KEY` (Ticketmaster links), `CRON_SECRET` (weekly guide check). Affiliate IDs are in the code. None are needed to build the static page locally.
- Schedules are scraped from public listing pages; when a source site changes its markup the parser in `lib/` or `api/` needs updating (the weekly guide check emails a report).
