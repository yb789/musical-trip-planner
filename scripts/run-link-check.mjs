// One-off: run the nightly link check without storing (GitHub Actions, no DB / Ticketmaster key).
import { runLinkCheck } from "../lib/link-check.js";
const r = await runLinkCheck({ store: false });
console.log("COUNTS", JSON.stringify(r.counts), "notChecked", r.notChecked, "seconds", r.seconds, "errors", JSON.stringify(r.errors));
for (const x of r.rows) console.log("ROW", x.result, x.seller, x.city, JSON.stringify(x.show), x.date, x.time, x.url, x.detail);
