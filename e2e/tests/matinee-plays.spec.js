// Plays on the matinee pages: their own table and quick answer, not counted with the musicals.
// People search "broadway plays offering matinee times this week" (weekly SEO report, 23 Nov 2026),
// and the page used to list musicals only.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, LOCAL } from "./fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const inSite = code => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" }));
const CODE_ONLY = "checks the site's code; runs with the local copy, where the site's packages are installed";

// A plain week: two musicals every day; Cursed Child and Oh, Mary! with Wednesday and Saturday matinees.
const WEEK_DATA = `
  const week = (start, plays = true) => {
    const schedule = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.parse(start + "T12:00:00Z") + i * 86400000).toISOString().slice(0, 10);
      schedule[d] = [["Wicked", "14:00"], ["Wicked", "19:00"], ["Hamilton", "14:00"]];
      if (plays && (i === 2 || i === 5)) schedule[d].push(["Harry Potter and the Cursed Child", "14:00"], ["Oh, Mary!", "15:00"], ["Oh, Mary!", "20:00"]);
    }
    const end = Object.keys(schedule).sort().pop();
    return { start, end, refreshedAt: "2026-11-23T00:00:00Z", shows: [], schedule };
  };`;

test.describe("plays on the matinee pages", () => {
  test("plays get their own table and quick answer; musical counts are unchanged", () => {
    test.skip(!LOCAL, CODE_ONLY);
    const r = inSite(`import { renderMatinees } from "./lib/site-pages.js";${WEEK_DATA}
      console.log(JSON.stringify({
        html: renderMatinees("new-york", week("2026-11-30"), {}),
        none: renderMatinees("new-york", week("2026-11-30", false), {}),
      }));`);
    expect(r.html).toContain('<h2 id="plays">Plays with a matinee this week</h2>');
    expect(r.html).toContain('<a href="/new-york/harry-potter-and-the-cursed-child/">Harry Potter and the Cursed Child</a>');
    // Finish time from the running time (Oh, Mary! 1h 20m); evening performances are not listed.
    expect(r.html).toContain("3:00 pm → 4:20 pm");
    expect(r.html).not.toContain("8:00 pm");
    expect(r.html).toContain("Which Broadway plays have matinees this week?");
    expect(r.html).toContain("Harry Potter and the Cursed Child (Wed 2:00 pm; Sat 2:00 pm) and Oh, Mary! (Wed 3:00 pm; Sat 3:00 pm).");
    expect(r.html).toContain("Plus 2 plays.");
    // The musical facts still count musicals only (Wicked and Hamilton).
    expect(r.html).toContain("2 of 2 musicals have at least one matinee this week.");
    expect(r.html).not.toMatch(/Wednesday matinees[\s\S]*?Cursed Child[\s\S]*?<h2 id="thursday">/);
    // A week without play matinees has no plays table, and the description does not mention plays.
    expect(r.none).not.toContain('id="plays"');
    expect(r.none).not.toContain("Plus 0 plays");
  });
});
