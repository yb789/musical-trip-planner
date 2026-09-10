# Musical Trip Planner — Live Schedule Version

This version performs a fresh schedule lookup whenever the user confirms a date range, changes the dates, or switches between London and Broadway.

## Why this cannot run on GitHub Pages alone

GitHub Pages only serves static files. The live planner needs a small server-side `/api/schedule` function because theatre websites generally do not allow a browser page on another domain to read their HTML directly (CORS), and the HTML must be parsed into show/date/time data.

You can still keep the project on GitHub. Deploy that GitHub repository with Vercel.

## Deploy with GitHub + Vercel

1. Create or update your GitHub repository.
2. Upload all files in this folder, preserving the `api` folder.
3. Go to https://vercel.com and sign in.
4. Choose **Add New → Project** and import your GitHub repository.
5. Framework preset: **Other**.
6. No environment variables are required.
7. Click **Deploy**.
8. Use the Vercel URL as the live website.

## Live sources

London:
- LondonTheatre.co.uk date-specific musical listings identify which productions are musicals.
- London Box Office date-specific pages provide listed performance times.

Broadway:
- Broadway.org / The Broadway League performance-time grids provide date-specific schedules.
- Broadway.org individual show pages are used to confirm that a production is categorized as a Musical.

## Important production note

This implementation reads public website pages. Website markup can change, which can require updating the parser. For a commercial/production service, obtain an authorized theatre/ticket data API or feed where possible and review the source sites' applicable terms.

The app keeps the existing disclaimer that ticket transactions happen on third-party websites and are not processed by this planner.
