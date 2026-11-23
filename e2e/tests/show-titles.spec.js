// Show-page titles name what people search for: matinee times, finish times and running time.
// The "<show> running time / how long" searches ranked well below the same pages' "finish"
// searches while the title only said "Finish" (weekly SEO report, 23 Nov 2026).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, LOCAL } from "./fixtures.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const inSite = code => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { cwd: ROOT, encoding: "utf8" }));
const CODE_ONLY = "checks the site's code; runs with the local copy, where the site's packages are installed";

test.describe("show-page titles", () => {
  test("say matinee, finish and running time when the running time is known", () => {
    test.skip(!LOCAL, CODE_ONLY);
    const r = inSite(`import { showMeta } from "./lib/site-pages.js";
      const show = { title: "The Phantom of the Opera", venue: "His Majesty's Theatre" };
      const c = { short: "London" };
      const now = Date.parse("2026-11-23T12:00:00Z");
      const mats = [{ time: "14:30", days: new Set(["Thursday", "Saturday"]) }];
      const eves = [{ time: "19:30", days: new Set(["Monday", "Tuesday"]) }];
      console.log(JSON.stringify({
        both: showMeta({ show, c, venue: show.venue, mats, eves, mins: 150, now }),
        evOnly: showMeta({ show, c, venue: show.venue, eves, mins: 150, now }),
        noTimes: showMeta({ show, c, venue: show.venue, mins: 150, now }),
        noRuntime: showMeta({ show, c, venue: show.venue, mats, eves, now }),
      }));`);
    expect(r.both.title).toBe("The Phantom of the Opera Matinee, Finish & Running Times (Nov 2026) · London");
    expect(r.both.description).toContain("Running time 2h 30m.");
    expect(r.both.description).toContain("ends ~5pm");
    expect(r.evOnly.title).toBe("The Phantom of the Opera Show, Finish & Running Times (Nov 2026) · London");
    expect(r.noTimes.title).toBe("The Phantom of the Opera Show Times & Running Time (Nov 2026) · London");
    // Without a running time the title can't promise one.
    expect(r.noRuntime.title).toBe("The Phantom of the Opera Matinee & Evening Times (Nov 2026) · London");
  });
});
