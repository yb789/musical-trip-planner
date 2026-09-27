# Musical Trip Planner — Handoff addendum (27 Sep 2026)

> Read this **together with `AI_HANDOFF.md`**. Where they disagree, this file wins.
> Covers PR #9 (merged into `main` as `9e7dc88`): opening screen, "Help me choose" show helper, and real PDF export.

---

## 1. Startup flow has changed (replaces AI_HANDOFF.md §4 "Required startup flow")

The site now opens on a full-screen **opening screen** (`#/start`) instead of going straight to the date popup:

- City toggle: London · West End / New York · Broadway
- **I know what I want** → closes the opening screen. The existing city/date popup is already underneath, so the old flow continues unchanged.
- **Help me choose** → 4-question helper (`#/helper`)
- "Continue your plan" appears when the browser has saved performances. "See my shortlist" appears when a helper shortlist exists.
- Shared plan links (`/?plan=CODE`) **skip** the opening screen. The date-calendar importer strips `?plan=` from the URL before the helper script runs, so a tiny head script sets `window.MH_SHARED_PLAN` first.

Hash routes: `#/start`, `#/helper`, `#/helper/results`, `#/plan`. The browser Back button moves between them.

## 2. "Help me choose" helper

- Questions: who's coming (solo/couple/family/group), vibe (spectacle/feel-good/moving/funny & irreverent), well-known vs newer, how many shows (→ 3 / 5 / 8 results). Tapping an answer moves on automatically, with no Next button.
- Scoring lives in `rank()` in `show-helper.js`:
  - vibe match +3
  - family: family show +3, teens −1, adults −10
  - couple: moving +1; group: feel-good or edgy +1
  - familiar/newer preference +2
- Candidates:
  - **Before dates are loaded:** every guide show that is not `status: "upcoming"` and not past `bookingUntil`.
  - **After dates are loaded:** only guide shows that the live `/api/schedule` data lists for those dates.
- Results page: heart shows, then "Plan N shows". If nothing is hearted, all shown results are planned.
- Stored in `localStorage` key `musicalPlannerHelper`: `{city, ans, short:{london:[ids], broadway:[ids]}}`. This is separate from the existing `musicalPlannerLive` key.

### Planner integration
- `window.renderSidebar` and `window.renderDay` are wrapped. The wrappers run after the ticket-confirmation override.
- The sidebar pins shortlisted shows to the top with a "♥ Shortlist" badge. Day cards get the same badge.
- A shortlist banner above `.layout` crosses out shows not playing on the chosen dates. It also has buttons for Show only my shortlist / Show all musicals (these use the existing `state.excluded` filter), Edit shortlist and Remove shortlist.
- A "Help me choose" button was added to the trip bar tools.
- Live show names are matched to guide entries by normalising titles (lowercase, strip accents, `&`→and, leading "the", non-alphanumerics, and a trailing "the musical"/"musical"/"a new musical"), then comparing against each entry's `title` and `match` list.

## 3. Show guide data

- `data/shows-london.json` (35 shows) and `data/shows-broadway.json` (24 shows, including 4 upcoming).
- Fields: `id, title, match[], venue, status (running|upcoming), dates, bookingUntil, limitedRun, vibes[], audience (family|teens|adults), familiar, runtime, blurb, listen, review`.
- **All blurbs and tags are drafts** (`"review": "draft"`), written by Claude and pending Yuval's review. The review table is in the claude.ai project doc `london-show-data-review-2026-09-27.md`.
- Sources, as of 27 Sep 2026:
  - London: londontheatre.co.uk and londonboxoffice.co.uk/musicals
  - Broadway: playbill.com and broadway.com
- Refresh the lists every few months. A show missing from the guide still appears in the planner, just without helper tags.

## 4. PDF export changed (updates AI_HANDOFF.md §14)

`window.print()` did nothing in many phone and in-app browsers, so "Export to PDF" appeared broken. `pdf-export.js` now:

- loads jsPDF 2.5.2 and jspdf-autotable 3.8.4 from jsDelivr on demand, pre-loading them when "Finish planning" is clicked
- builds a landscape A4 table with the same rows as before (`selectedRows()`); the ticket columns only appear if any ticket data exists
- on touch devices, opens the share sheet (`navigator.share` with the file); otherwise downloads `musical-schedule-<city>-<start>-to-<end>.pdf`
- falls back to the old print view if the library can't load
- rewrites text to Latin-1, because jsPDF's built-in Helvetica can't render characters like curly quotes or en dashes

## 5. Build chain

`build.mjs` now ends with:

```
'patch-show-tooltip.mjs',
'patch-show-helper.mjs',   // inlines show-helper.css/js + slimmed guide JSON as window.SHOW_GUIDE
'patch-pdf-export.mjs'     // inlines pdf-export.js; must run after patch-ticket-confirmation.mjs
```

New files: `show-helper.js`, `show-helper.css`, `patch-show-helper.mjs`, `pdf-export.js`, `patch-pdf-export.mjs`, `data/`.

## 6. Tested

A headless Chromium run against a mocked `/api/schedule`, at 1280px and 390px, covered:

- the opening screen, the quiz, results and hearts
- the handoff to the date picker, including the shortlist note in the modal
- banner, pinning and badges, show only / show all
- Back navigation, returning-visitor notes, and shared links skipping the opening screen
- Broadway ranking
- no horizontal overflow
- the PDF download, which rendered correctly

Yuval checked the Vercel preview on his phone before merge.

## 7. Open items
- Yuval's review of the guide blurbs and tags.
- Consider adding Off-Broadway shows and the 2027 Broadway musicals once they have dates.
- SeatPlan affiliate links on the helper's show cards once Impact verification is approved.
- The Obsidian copy of the handoff (Dropbox `/obsidian vault/general/apps/Musical Trip Planner - AI Handoff.md`) still needs this addendum added.
