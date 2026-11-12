// serve-dist.mjs
// Foreground static server over dist/, for Playwright's webServer and for any
// human who wants to poke at the built site. Zero dependencies, node:http only.
//
// Why not `astro preview`. Astro 7.3 starts the preview server as a DETACHED
// BACKGROUND process whenever it thinks an AI agent is driving the terminal:
//
//   const agentDetected = !process.env.ASTRO_PREVIEW_BACKGROUND && isRunByAgent();
//   const wantsBackground = !!flags.background || agentDetected;
//
// (node_modules/astro/dist/cli/preview/index.js; isRunByAgent() is am-i-vibing's
// detectAgenticEnvironment(), which keys off markers such as CLAUDECODE.) The
// foreground process then exits immediately, and Playwright, whose webServer
// contract requires the command to STAY in the foreground, aborts with
// "Process from config.webServer exited early." There is no flag that forces
// the foreground back on once detection fires: `--ignore-lock` is rejected in
// combination with background mode, and `--background=false` does not clear
// agentDetected. Astro also binds the daemon to IPv6 [::1] only and guards it
// with a lock file that makes a second `astro preview` throw. None of that is
// wrong for interactive use; it is simply not a test fixture. This script is,
// so the e2e suite no longer depends on how Astro classifies the caller.
//
// Behavior matches what the built site needs and what the specs assert:
//   - trailingSlash: "always", so /framework/ serves dist/framework/index.html
//   - a bare /framework redirects (301) to /framework/
//   - an unknown route serves dist/404.html with a real 404 status
//     (e2e/journeys.spec.ts asserts response.status() === 404)
//   - query strings are ignored for resolution (/?error=invalid is the home page)
//
// Usage: node scripts/serve-dist.mjs [--port 3302] [--host 127.0.0.1]
// Binds 127.0.0.1 by default, NOT localhost, so the listening stack and the
// address Playwright probes cannot disagree about IPv4 versus IPv6.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(siteRoot, "dist");

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const PORT = Number(flag("port", process.env.PORT ?? 3302));
const HOST = flag("host", "127.0.0.1");

// Only the types the built site actually serves. Anything else falls back to
// application/octet-stream, which browsers download rather than mis-execute.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".webmanifest": "application/manifest+json",
};
const contentType = (path) => {
  const dot = path.lastIndexOf(".");
  return (dot === -1 ? undefined : TYPES[path.slice(dot).toLowerCase()]) ?? "application/octet-stream";
};

const isFile = (path) => existsSync(path) && statSync(path).isFile();

// Resolve a URL pathname to a file inside dist/, or to null. The normalize plus
// prefix check is the traversal guard: a request for /../../etc/passwd resolves
// outside distRoot and is refused rather than served.
const resolveFile = (pathname) => {
  const decoded = decodeURIComponent(pathname);
  const candidate = resolve(distRoot, "." + normalize(decoded));
  if (candidate !== distRoot && !candidate.startsWith(distRoot + sep)) return null;
  if (isFile(candidate)) return candidate;
  const indexFile = join(candidate, "index.html");
  if (isFile(indexFile)) return indexFile;
  return null;
};

const sendFile = (res, file, status) => {
  res.writeHead(status, {
    "content-type": contentType(file),
    "cache-control": "no-store",
  });
  createReadStream(file).pipe(res);
};

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { allow: "GET, HEAD" }).end();
    return;
  }

  const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  const file = resolveFile(pathname);
  if (file) {
    sendFile(res, file, 200);
    return;
  }

  // trailingSlash: "always". A bare directory path is a redirect, not a 404,
  // which is how the deployed site behaves too.
  if (!pathname.endsWith("/") && resolveFile(pathname + "/")) {
    res.writeHead(301, { location: pathname + "/" }).end();
    return;
  }

  const notFound = join(distRoot, "404.html");
  if (isFile(notFound)) {
    sendFile(res, notFound, 404);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found\n");
});

if (!existsSync(distRoot)) {
  console.error(`No build found at ${distRoot}. Run \`npm run build\` first.`);
  process.exit(1);
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} on ${HOST} is already in use. Stop whatever holds it (an earlier ` +
        "preview, or `astro preview stop`) and try again.",
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Serving dist/ at http://${HOST}:${PORT}/`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
