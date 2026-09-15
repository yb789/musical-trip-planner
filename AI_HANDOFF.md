# Musical Trip Planner — Complete AI Handoff

> **Purpose:** This file is a self-contained handoff for continuing the project in ChatGPT, Claude, Gemini, Cursor, Copilot, Codex, or another AI/coding platform without needing the original conversation.
>
> **Last consolidated:** 2026-09-11
>
> **Current production repo:** `yb789/musical-trip-planner`
>
> **Public site:** https://musical-trip-planner.vercel.app
>
> **Current `main` HEAD at handoff:** `e62e75f5a129043ef119e7dba17eba407c2ed12c`
>
> **Vercel status for that commit:** successful

---

## 1. What the app does

**Musical Trip Planner** is a web app for planning musical-theatre trips in:

- **London — West End**
- **New York — Broadway**

The user chooses a city and a date range, the app loads live/date-specific musical schedules, and the user builds an itinerary with up to:

- **one matinee/afternoon show per date**
- **one evening show per date**

The app also provides:

- a date-specific list of musicals
- show filtering
- duplicate-musical warnings
- a calendar view of the chosen itinerary
- ticket links
- theatre/venue links
- Excel export
- PDF/print export
- theatre names and addresses
- a legal ticket-purchase disclaimer

The project started as a static September 2026 planner and was later generalized so the user can choose arbitrary date ranges from a calendar and the app performs a fresh lookup each time.

---

## 2. Repository and deployment

### GitHub

Repository:

`https://github.com/yb789/musical-trip-planner`

Primary branch:

`main`

The repo is connected to Vercel. A push/commit to `main` triggers a Vercel deployment.

### Vercel

Public production site:

`https://musical-trip-planner.vercel.app`

The project uses Vercel because the app needs a server-side endpoint (`/api/schedule`). GitHub Pages alone is not sufficient because the browser cannot reliably scrape theatre sites directly because of CORS and because HTML parsing must happen server-side.

### Current build configuration

`vercel.json` currently uses a build process similar to:

```json
{
  "buildCommand": "node patch-index.mjs && node patch-calendar-v2.mjs && node patch-price-simple.mjs && mkdir -p public && cp index.html public/index.html",
  "outputDirectory": "public",
  "rewrites": [
    {
      "source": "/",
      "destination": "/index.html"
    }
  ]
}
```

The `public` copy step was added because Vercel previously failed with:

> No Output Directory named "public" found after the Build completed.

Do not remove the `outputDirectory`/copy behavior without changing the Vercel project settings accordingly.

---

## 3. Current repository structure

Important files:

```text
musical-trip-planner/
├── index.html
├── package.json
├── vercel.json
├── README.md
├── patch-index.mjs
├── patch-calendar-v2.mjs
├── patch-price-simple.mjs
├── patch-clean-show-titles.mjs
└── api/
    ├── schedule.js
    ├── broadway.js
    └── broadway2.js
```

### What each file is for

**`index.html`**
- Main frontend.
- Contains HTML, CSS, and browser-side JavaScript.
- Handles the date/city popup, filters, show selection, calendar, local storage, duplicate warnings, and export UI.

**`api/schedule.js`**
- Main Vercel serverless schedule endpoint.
- Route format:

```text
/api/schedule?city=london&start=YYYY-MM-DD&end=YYYY-MM-DD
/api/schedule?city=broadway&start=YYYY-MM-DD&end=YYYY-MM-DD
```

- London is handled directly in this file.
- Broadway is dispatched to `broadway2.js`.

**`api/broadway2.js`**
- Current Broadway schedule parser/fallback.
- Added after Broadway.org began returning HTTP 403 to Vercel.
- Reads Broadway.com show/schedule pages instead.

**`api/broadway.js`**
- Earlier Broadway fallback/parser.
- It remains in the repo but the current main schedule dispatcher uses `broadway2.js`.
- Treat it as legacy unless intentionally reintroduced.

**`patch-index.mjs`**
- Build-time patch used to add/maintain frontend behavior, including theatre/address-related functionality.

**`patch-calendar-v2.mjs`**
- Build-time patch for calendar/export location resolution.
- Handles fallback show → theatre resolution so older saved choices with generic venue names can still obtain theatre names/addresses.
- Latest change addressed blank addresses in PDF schedules.

**`patch-price-simple.mjs`**
- Build-time defensive cleanup for Broadway price text leaking into show titles.

**`patch-clean-show-titles.mjs`**
- Older/more aggressive price-title cleanup work.
- Currently not part of the active Vercel build command.

---

## 4. Required startup flow

When the site first opens, show a startup modal that asks for:

1. **City**
   - London · West End
   - New York · Broadway
2. **From date**
3. **To date**
4. **Continue to planner**

The user should not have to enter the planner first and then choose dates.

The same popup is reused later through:

**Change city / dates**

The live-search range is currently limited to **21 days or fewer**.

When the user confirms the startup form:

1. validate both dates
2. validate end date >= start date
3. close the startup modal
4. show a visible loading state
5. call `/api/schedule`
6. rebuild the musical list and date schedule
7. render the planner

---

## 5. City behavior

The app supports two independent city modes:

### London

Label:

`London · West End`

### Broadway

Label:

`New York · Broadway`

The city can be selected at startup and can still be switched inside the planner.

A city switch should perform a new live lookup for the selected date range.

Selections/filters are stored separately per city.

---

## 6. Date-specific musical list

This was an important product requirement.

The left-side musical list must show **only musicals performing on the currently selected date**.

Example:

- user selects Sep 14
- left panel shows only musicals with a performance Sep 14
- user selects Sep 15
- left panel refreshes to musicals playing Sep 15

A musical not running on that day must not be offered in the left list for that day.

The heading should communicate the selected date, e.g.:

`1. Broadway musicals · 14 Sept`

### Filters

The user can untick shows they do not want to consider.

The left list includes:

- search box
- Select all
- Clear all
- count of available/kept musicals

**Select all** and **Clear all** should act on the musicals available on the active date.

---

## 7. Matinee and evening rules

Performances are split into two sessions:

### Matinee / afternoon

Start time **before 17:00**

### Evening

Start time **17:00 or later**

The start time should always be clearly visible.

The user may select:

- maximum **one matinee**
- maximum **one evening**

on each date.

Therefore two shows on the same date are allowed if one is matinee and one is evening.

---

## 8. Duplicate-musical warning

The same musical may be chosen more than once during a trip, but it requires explicit confirmation.

Example:

- user selects `Hamilton` on Sep 14
- later selects `Hamilton` on Sep 16
- app opens a popup saying the musical was already selected
- popup shows where it was previously selected
- asks:

> Are you sure you want to choose this musical again?

Buttons:

- **No, cancel** → do not make the new selection
- **Yes, choose again** → allow the duplicate

The duplicate rule applies across:

- different dates
- different sessions

Do not silently block duplicates. The user must be allowed to override the warning.

---

## 9. My Calendar view

The app has two tabs:

- **Choose shows**
- **My calendar**

The calendar displays the selected itinerary by date.

For each selected performance the intended display is:

```text
🌙 Maybe Happy Ending
19:00
🎭 Belasco Theatre
📍 111 W 44th St, New York, NY 10036, USA
```

or equivalent for a matinee.

### Important: no prices in the calendar

Do **not** show:

- ticket price
- `from $...`
- `Save $...`
- discounts

A Broadway.com issue caused prices to be appended to show titles, such as:

```text
Maybe Happy Ending from $61.03 Save $84.00
SIX: The Musical from $64.01 Save $77.75
```

Those must be cleaned to:

```text
Maybe Happy Ending
SIX: The Musical
```

The cleanup should be performed as early as possible at the API/data level and defensively again in the frontend for old cached/saved selections.

### Old saved selections

Older browser `localStorage` selections may have:

- price text in the musical name
- generic venue like `Broadway, New York`
- no address field

The calendar/export logic therefore includes fallbacks to resolve the clean musical name to a known theatre, then the theatre to an address.

---

## 10. Theatre names and addresses

The user explicitly requested theatre/venue name and address in the app calendar and exports.

The intended hierarchy is:

1. use a live/API-provided address when available
2. otherwise use the live theatre name
3. if theatre name is missing/generic, resolve theatre from musical name
4. resolve address from the built-in theatre address directory

Examples of Broadway mappings used in the project include:

| Musical | Theatre |
|---|---|
| Aladdin | New Amsterdam Theatre |
| & Juliet | Stephen Sondheim Theatre |
| The Book of Mormon | Eugene O'Neill Theatre |
| Chicago | Ambassador Theatre |
| The Great Gatsby | Broadway Theatre |
| Hadestown | Walter Kerr Theatre |
| Hamilton | Richard Rodgers Theatre |
| The Lion King | Minskoff Theatre |
| Maybe Happy Ending | Belasco Theatre |
| MJ | Neil Simon Theatre |
| Operation Mincemeat: A New Musical | John Golden Theatre |
| The Outsiders | Bernard B. Jacobs Theatre |
| SIX: The Musical | Lena Horne Theatre |
| Wicked | Gershwin Theatre |

London fallbacks include productions/theatres such as:

| Musical | Theatre |
|---|---|
| The Phantom of the Opera | His Majesty's Theatre |
| Les Misérables | Sondheim Theatre |
| Mamma Mia! | Novello Theatre |
| The Book of Mormon | Prince of Wales Theatre |
| The Lion King | Lyceum Theatre |
| Matilda The Musical | Cambridge Theatre |
| Oliver! | Gielgud Theatre |
| ABBA Voyage | ABBA Arena |
| Wicked | Apollo Victoria Theatre |
| Hamilton | Victoria Palace Theatre |
| Hadestown | Lyric Theatre |
| Paddington The Musical | Savoy Theatre |
| Operation Mincemeat | Fortune Theatre |

These fallback maps are implementation aids, not guaranteed authoritative live data. They should be reviewed when productions move theatres.

---

## 11. Ticket links

After a performance has been chosen, the schedule should provide two types of links:

1. **Ticket website**
2. **Theater / venue tickets**

The wording was deliberately changed from “Verified” to:

- `Ticket website`
- `Theater / venue tickets`

Do not call the first link “Verified ticket website”.

Links should open in a new tab and should preferably point to well-known/official sources.

---

## 12. Ticket-purchase disclaimer

The app must make clear that ticket transactions are handled by third parties.

Current intent of the legal language:

> This planner is provided solely as an itinerary and information tool and is not a ticket seller, ticket agent, box office, or payment processor. Ticket-purchase and theatre/venue links open independent third-party websites. All purchases, payments, delivery, seat allocation, availability, pricing, fees, exchanges, cancellations, refunds, rescheduling, accessibility arrangements, and other transaction terms are governed by the third-party provider. The planner does not process ticket payments or guarantee availability, pricing, seating, performance times, admission, or third-party services. Users should independently verify all details before purchasing.

Keep similar language visible in the app.

---

## 13. Finish-planning flow

There is a **Finish planning** button.

It opens a confirmation popup:

> Are you finished choosing your performances for this trip?

Choices:

- **No, keep editing**
- **Yes, I'm finished**

After confirmation, the user is offered export options.

This flow previously became stuck because the click handlers were missing. Ensure all dialog buttons have working event listeners.

---

## 14. Export behavior

After the user finishes planning, support:

### Excel

Download an Excel-compatible `.xls` itinerary.

Expected columns include:

- City
- Date
- Session
- Start Time
- Musical
- Theater / Venue
- Address
- Ticket Website
- Theater / Venue Website

### PDF

The “PDF” workflow uses a clean browser print layout and then `window.print()`.

The user chooses **Save as PDF** in the browser print dialog.

Expected PDF columns:

- Date
- Session
- Time
- Musical
- Theater / Venue
- Address

### Important export requirements

- no ticket prices in the schedule
- musical names must be cleaned
- theatre name must be shown
- address must be shown
- older saved choices must be enriched through show→theatre→address fallback

The latest `main` commit at handoff (`e62e75f`) specifically addressed blank PDF address values by resolving the theatre from the musical name before looking up the address.

---

## 15. Data persistence

The planner uses browser `localStorage`.

Saved information includes things such as:

- selected city
- excluded/filtered shows per city
- chosen performances per city

Be careful when changing object shapes because existing users may have old saved data.

Defensive migration/normalization is useful, especially for:

- old price-containing show names
- missing address
- generic venue
- old selections made before newer fields existed

---

## 16. Live data — London

The current London endpoint is implemented in:

`api/schedule.js`

The current implementation reads public pages and parses their HTML.

Sources currently referenced in the implementation:

- **LondonTheatre.co.uk** for date-specific musical identification/listings
- **London Box Office** for performance times

The logic:

1. request each date
2. identify musicals
3. identify performance blocks/times
4. match the titles
5. build normalized `shows` + `schedule`
6. deduplicate title/time combinations
7. cache results for a short period

A live schedule response has the conceptual form:

```json
{
  "city": "london",
  "start": "2026-09-14",
  "end": "2026-09-17",
  "shows": [
    {
      "name": "Example Show",
      "venue": "Example Theatre",
      "ticketUrl": "...",
      "infoUrl": "..."
    }
  ],
  "schedule": {
    "2026-09-14": [
      ["Example Show", "19:30"]
    ]
  },
  "sources": ["..."]
}
```

---

## 17. Live data — Broadway

### Original problem

The initial Broadway implementation depended on Broadway.org / The Broadway League.

In Vercel logs, Broadway requests started failing with:

```text
403 from www.broadway.org
```

London requests were returning 200 while Broadway returned 502 because the upstream Broadway.org request was blocked.

### Current solution

`api/schedule.js` dispatches:

```js
if (city === "broadway") {
  return broadwayHandler(req, res);
}
```

where `broadwayHandler` is imported from:

`./broadway2.js`

`broadway2.js` uses **Broadway.com** show and full-schedule pages instead of relying on Broadway.org.

The main idea:

1. discover Broadway musical show pages
2. visit each show’s `/schedule/` page
3. parse future performance dates/times
4. include only performances within requested range
5. normalize and deduplicate titles/times
6. strip Broadway.com price offer text from titles
7. return the same normalized frontend structure

### Important title cleanup

Broadway.com can attach offer text to title strings.

The API/frontend must remove suffixes beginning with patterns such as:

```text
from $61.03
from $64.01 Save $77.75
Save $84.00
```

Do not show prices in either:

- Choose shows
- selected show summary
- My calendar
- PDF
- Excel

---

## 18. Live endpoint test

To test the backend directly, use the public Vercel domain.

Example:

```text
https://musical-trip-planner.vercel.app/api/schedule?city=broadway&start=2026-09-14&end=2026-09-17
```

London:

```text
https://musical-trip-planner.vercel.app/api/schedule?city=london&start=2026-09-14&end=2026-09-17
```

Expected result:

- HTTP 200
- JSON
- `shows`
- `schedule`
- city/start/end fields

Vercel runtime logs previously confirmed repeated `/api/schedule` requests returning HTTP 200 after the Broadway routing fixes.

---

## 19. Vercel troubleshooting history

These problems occurred and are useful context for future debugging.

### Blank/stuck startup popup

Cause:
- missing frontend event listener bindings.

Fix:
- restore click handlers for Continue to planner and other controls.
- close startup popup after valid dates are accepted, then run search.

### Finish-planning modal stuck

Cause:
- missing/incorrect event listeners and step toggling.

Fix:
- explicit handlers for:
  - Yes, I'm finished
  - No, keep editing
  - Excel
  - PDF
  - Return to planner

### Broadway 403

Log error:

```text
Error: 403 from www.broadway.org
```

Fix:
- Broadway schedule handling migrated to `broadway2.js` using Broadway.com full schedule pages.

### Vercel build failure: no public folder

Error:

```text
No Output Directory named "public" found after the Build completed.
```

Fix:
- build now creates `public`
- copies patched `index.html` to `public/index.html`
- sets `"outputDirectory": "public"`

### Price text kept showing after fixes

Cause:
- Vercel production was still serving an older successful deployment while newer builds had failed.
- price text was also part of the scraped show title, not a separate price field.

Fixes:
- strip price at API/data source
- add defensive frontend cleanup
- fix build pipeline so changes actually deploy
- use clean-title matching for old localStorage data

---

## 20. Important commits/history

Useful milestones from the development conversation:

- `9aa12fe` — date-aware musical list
- `b057b25` — Broadway routing toward new full-schedule parser
- `f1bce57` — city selector added to startup date popup
- `a3c849d` — theatre names and addresses added to calendar/exports
- `945aadc` — Broadway price offer stripping at API source
- `aaf5789` — Vercel `public` output-directory build fix
- `e62e75f` — resolve PDF theatre addresses from show names

**Current main HEAD at this handoff:** `e62e75f5a129043ef119e7dba17eba407c2ed12c`

Before changing code, verify `main` again because newer work may exist.

---

## 21. Current deployment health

At handoff:

- `main` points to `e62e75f...`
- Vercel status for that commit was **success**
- `/api/schedule` runtime requests were returning **200**
- the app was considered functionally close to/at a satisfactory v1 state

One item had just been addressed:
- PDF Address column had been empty
- `e62e75f` added show-name → theatre fallback before address lookup

If continuing, verify that PDF/Excel addresses are populated after a clean browser refresh and a newly generated export.

---

## 22. Testing checklist before any future release

Use a private/incognito window when possible so old localStorage does not hide migration bugs.

### Startup

- [ ] City selector appears at startup
- [ ] London can be selected
- [ ] Broadway can be selected
- [ ] start date works
- [ ] end date works
- [ ] invalid range is rejected
- [ ] Continue to planner works

### Live data

- [ ] London returns schedules
- [ ] Broadway returns schedules
- [ ] changing city triggers a new request
- [ ] changing dates triggers a new request
- [ ] dates outside the original Sep 24–30 range work

### Date-aware filtering

- [ ] left list changes when date changes
- [ ] only shows actually performing on active date are displayed
- [ ] Select all applies to active date
- [ ] Clear all applies to active date

### Selection rules

- [ ] one matinee maximum
- [ ] one evening maximum
- [ ] one matinee + one evening on same date is allowed
- [ ] selecting same musical again shows warning
- [ ] No cancels duplicate
- [ ] Yes allows duplicate

### Prices

- [ ] no `from $...` in left list
- [ ] no price in performance card
- [ ] no price in selected summary
- [ ] no price in My calendar
- [ ] no price in exports

### Calendar

- [ ] show name displayed
- [ ] time displayed
- [ ] theatre name displayed
- [ ] street address displayed
- [ ] clicking a calendar date returns to/edit that date correctly

### Ticket links

- [ ] Ticket website opens
- [ ] Theater / venue tickets opens
- [ ] external links open in new tab
- [ ] disclaimer is visible

### Finish/export

- [ ] Finish planning opens
- [ ] No returns to planner
- [ ] Yes advances to export choices
- [ ] Excel exports
- [ ] PDF print view opens
- [ ] theatre shown in exports
- [ ] address shown in exports

---

## 23. Recommended cleanup for a future v2

The project works, but the architecture grew through iterative patches. A future refactor should reduce fragility.

Recommended direction:

1. move the final frontend logic directly into source modules instead of patching `index.html` during every build
2. remove unused/legacy files after verifying behavior, especially older Broadway fallback code
3. replace scraping with authorized theatre/ticket APIs or feeds if this becomes a serious/public commercial product
4. add automated tests for:
   - title cleaning
   - date parsing
   - matinee/evening split
   - duplicate selection behavior
   - show→theatre→address resolution
5. add a simple backend health test for London and Broadway
6. keep production changes on feature branches before merging to `main`
7. consider a canonical data model:

```ts
type Show = {
  id: string;
  city: "london" | "broadway";
  name: string;
  venue: string;
  address?: string;
  ticketUrl?: string;
  venueUrl?: string;
};

type Performance = {
  showId: string;
  date: string;
  time: string;
};

type Selection = {
  date: string;
  session: "matinee" | "evening";
  showId: string;
  time: string;
};
```

This would make the system easier to maintain than passing `[name,time]` arrays around.

---

## 24. Possible future product improvements

Ideas discussed or natural next steps:

- custom domain
- Vercel Analytics
- “Share my itinerary” link
- persistent trips/accounts
- collaborative itinerary
- map view of theatres
- route/travel-time estimates between matinee and evening theatres
- calendar export (`.ics`)
- better accessibility information
- official API integration
- additional theatre cities
- automated source-health monitoring

Do not add these at the expense of the existing simple planning flow.

---

## 25. Key product philosophy

The app should stay focused on this sequence:

```text
Choose city + dates
        ↓
See only relevant musicals
        ↓
Remove shows you do not want
        ↓
Choose one matinee and/or one evening per date
        ↓
Review My calendar
        ↓
Finish planning
        ↓
Export schedule / follow ticket links
```

The user should never need to understand how the schedule scraping/backend works.

---

## 26. Legal/data reliability considerations

The planner reads public theatre/ticket pages. Their HTML and terms can change.

Therefore:

- parsers may break without warning
- price/marketing text may contaminate scraped titles
- production locations can change
- performance schedules can change
- ticket availability can change

The app should display schedule information as planning information and make users verify final details on the theatre/ticket provider website.

For a commercial deployment, prefer authorized APIs/data feeds and review provider terms.

---

## 27. Prompt to give the next AI

Copy/paste this to a new AI coding platform:

> I am continuing a project called **Musical Trip Planner**. Read this entire handoff first, then inspect the current GitHub repository `yb789/musical-trip-planner` and treat the repository `main` branch as the source of truth. The production site is `https://musical-trip-planner.vercel.app`.
>
> Preserve these rules: startup city/date chooser; London and Broadway; fresh date-specific schedule lookup; left list only contains musicals performing on the selected date; maximum one matinee and one evening per day; duplicate musicals require a confirmation popup but may be allowed; no ticket prices anywhere in planner/calendar/exports; My calendar must show show name, time, theatre and address; Finish planning offers Excel/PDF export; ticket links are labeled “Ticket website” and “Theater / venue tickets”; keep the third-party ticket-purchase disclaimer.
>
> Current backend entry point is `/api/schedule`; London logic is in `api/schedule.js`; Broadway is currently routed to `api/broadway2.js`. Broadway.org previously returned HTTP 403 from Vercel, so the current Broadway implementation uses Broadway.com schedule pages.
>
> The project currently uses build-time patch scripts (`patch-index.mjs`, `patch-calendar-v2.mjs`, `patch-price-simple.mjs`) and Vercel builds a `public/index.html`. Do not casually remove that build flow without replacing it and testing Vercel.
>
> Before making changes, inspect `main`, confirm the latest Vercel deployment, and run the testing checklist in this handoff.

---

## 28. Fast recovery instructions

If the live site breaks after a future commit:

1. open Vercel project
2. check **Production Deployment**
3. confirm the source commit matches intended GitHub `main`
4. if deployment is red, open **Deployments → failed deployment → Deploy Logs**
5. distinguish:
   - **build error** from
   - **runtime `/api/schedule` error**
6. for schedule errors, inspect **Logs** and look for `/api/schedule`
7. test API directly in browser
8. if necessary, use Vercel rollback to the last known good deployment
9. do not assume refreshing the browser will fix a failed deployment

---

## 29. Obsidian/Dropbox note

Intended note location requested by the user:

```text
Dropbox/
└── obsidian vault/
    └── apps/
        └── Musical Trip Planner - AI Handoff.md
```

If `apps` does not yet exist in the vault, create it and place this file there.

Because this is plain Markdown, Obsidian and essentially every AI coding platform can read it directly.

---

## 31. Mobile / responsive layout (added 2026-09-15)

The site is responsive at three breakpoints (all in the base `<style>` of `index.html`):

- **≤900px (tablet / phone):** single column; the musical list (`#sidebar`) becomes a collapsible panel with a `#sidebarToggle` button ("Filter musicals · N of M kept"), collapsed by default (`class="collapsed"` on the aside — harmless on desktop because the collapse rules live inside the media query).
- **≤560px (phone):** 44px tap targets, ≥12px text, 16px inputs (prevents iOS focus-zoom), and **My calendar switches from the 7-column month grid to an agenda list** (one row per trip date with weekday label, `.day-wd`). The month grid is still rendered by JS; the agenda is pure CSS on `.day-cell.inrange`.

Two global rules matter for every width:

- `.layout>*{min-width:0}` — without it the horizontal day strip forces the whole page wider than the viewport (a 14-day trip made the page 1261px wide on a phone and 1629px on a 1280px laptop).
- `.overlay{overflow-y:auto;align-items:flex-start}.modal{margin:auto}` — modals taller than the screen (the date picker is ~810px) can be scrolled instead of being clipped.

The weekday label inside each calendar cell is emitted in **two** places because `date-calendar.js` overrides `renderCalendar` at runtime: `patch-index.mjs` (the built-in renderer) and `date-calendar.js` (the live one). Keep them in sync.

Verification script (not in the repo): build with `node build.mjs` in a scratch copy, then render `public/index.html` in headless Chromium at 375/390/768/1280/1440 with a mocked `/api/schedule` and check `document.documentElement.scrollWidth === innerWidth`.

---

## 30. Final state to preserve

At the time of this handoff, the desired v1 behavior is:

- public Vercel website
- GitHub-controlled production source
- London + Broadway
- startup city/date selection
- live schedule retrieval
- date-specific musical list
- matinee/evening planning
- duplicate confirmation
- ticket links
- no prices in planner/calendar/export
- theatre + address in calendar
- theatre + address in PDF/Excel
- legal third-party purchase disclaimer
- local browser persistence
- successful Vercel deployment

This file should be updated whenever a major architectural or product change is made.
