// Local stand-in for the Vercel deployment, so the end-to-end tests can run without deploying.
//   node e2e/local-server.mjs [port]        (default 8787)
// It copies the repo to a temporary folder, runs the normal build there (build.mjs rewrites
// index.html in place, so it must not run in the working copy), then serves:
//   - the built files from public/
//   - vercel.json rewrites (/go, /london/:slug, /plan/:code, ...)
//   - vercel.json response headers, including the Content-Security-Policy
//   - the api/*.js handlers, called the way Vercel calls them (req.query, req.body, res.status/send/json)
// There is no database and usually no access to the ticket sites here, so pages that need them
// (live schedule, show pages, shared plans) answer with an error. The tests know: with E2E_LOCAL=1
// they use a sample schedule and skip what needs the real services.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || process.env.PORT || 8787);

function prepare() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mtp-e2e-"));
  const skip = new Set(["node_modules", ".git", "e2e", "public", ".vercel", "android", "build-android"]);
  for (const name of fs.readdirSync(REPO)) {
    if (skip.has(name)) continue;
    fs.cpSync(path.join(REPO, name), path.join(dir, name), { recursive: true });
  }
  // The api handlers import cheerio, satori, ... from the repo's node_modules.
  if (!fs.existsSync(path.join(REPO, "node_modules"))) throw new Error("Run `npm ci` in the repo root first.");
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "dir");
  execFileSync(process.execPath, ["build.mjs"], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  return dir;
}

const ROOT = prepare();
process.chdir(ROOT); // the handlers read data/*.json relative to the working directory
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };

// "/london/:slug" -> { slug } when the path matches, else null.
function matchSource(source, pathname) {
  const names = [];
  const re = new RegExp("^" + source.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, n) => { names.push(n); return "([^/]+)"; }) + "$");
  const m = pathname.match(re);
  if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
}
const isFile = p => fs.existsSync(p) && fs.statSync(p).isFile();

const handlers = new Map();
async function apiHandler(name) {
  if (!handlers.has(name)) handlers.set(name, (await import(pathToFileURL(path.join(ROOT, "api", name + ".js")).href)).default);
  return handlers.get(name);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let pathname = url.pathname;
    let query = Object.fromEntries(url.searchParams);
    for (const h of cfg.headers || []) {
      if (!new RegExp("^" + h.source.replace(/\(\.\*\)/g, ".*") + "$").test(pathname)) continue;
      // upgrade-insecure-requests would turn this plain-http server's own requests into https.
      for (const x of h.headers) res.setHeader(x.key, x.value.replace(/;\s*upgrade-insecure-requests/, ""));
    }
    if (!isFile(path.join(PUBLIC, pathname))) {
      for (const r of cfg.rewrites || []) {
        const params = matchSource(r.source, pathname);
        if (!params) continue;
        const dest = new URL(r.destination.replace(/:(\w+)/g, (_, n) => encodeURIComponent(params[n])), "http://localhost");
        pathname = dest.pathname;
        query = { ...Object.fromEntries(dest.searchParams), ...query };
        break;
      }
    }
    if (pathname.startsWith("/api/")) {
      const name = pathname.slice(5).replace(/\/$/, "");
      if (!/^[a-z0-9-]+$/.test(name) || !isFile(path.join(ROOT, "api", name + ".js"))) { res.statusCode = 404; return res.end("Not found"); }
      req.query = query;
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString();
        try { req.body = JSON.parse(raw); } catch { req.body = raw; }
      }
      res.status = code => { res.statusCode = code; return res; };
      res.send = body => res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      res.json = body => { res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(body)); };
      return await (await apiHandler(name))(req, res);
    }
    const file = path.join(PUBLIC, pathname);
    if (!file.startsWith(PUBLIC) || !isFile(file)) { res.statusCode = 404; res.setHeader("Content-Type", "text/plain"); return res.end("Not found"); }
    res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
    res.end(fs.readFileSync(file));
  } catch (err) {
    console.error("local-server:", req.method, req.url, err?.message || err);
    if (!res.headersSent) res.statusCode = 500;
    res.end("Server error");
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Musical Trip Planner (local copy) on http://127.0.0.1:${PORT}`));
