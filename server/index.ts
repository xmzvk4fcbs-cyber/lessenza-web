/* eslint-disable no-console */
// L'Essenza self-hosted server — Express wrapper around the Netlify Functions.
// Boots SQLite as the KV store and mounts every /netlify/functions/*.ts
// file at the URL path its netlify.toml redirect would produce:
//   admin-<X>.ts → /api/admin/<X>
//   <X>.ts      → /api/<X>
// Static files under the project root are served too, so the server is the
// only process you need behind nginx.

import "./env-check"; // ensure required env vars are present before booting
import * as Sentry from "@sentry/node";
import express from "express";
import compression from "compression";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as cron from "node-cron";
import type { Handler } from "@netlify/functions";

import { setStore } from "../netlify/lib/blobs";
import { SqliteStore, resolveDbPath } from "./storage-sqlite";
import { toExpress } from "./adapter";

// --- 0. Error monitoring (optional, no-op if SENTRY_DSN not set) ---
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1, // 10% of requests
  });
  console.log("[sentry] error monitoring enabled");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const FUNCTIONS_DIR = path.join(PROJECT_ROOT, "netlify", "functions");

// --- 1. Storage: SQLite replacement for Netlify Blobs ---
const db = new SqliteStore(resolveDbPath());
setStore(db);
console.log(`[storage] sqlite → ${resolveDbPath()}`);

// --- 2. Express app ---
const app = express();
app.set("trust proxy", 1); // behind nginx
app.use(compression());

// Parse JSON + urlencoded bodies but hand the Netlify handler a RAW string
// (that's what Lambda passes). We restore `req.body` as a string below.
// 20 MB cap on the raw HTTP body. Image uploads come as base64 data URLs in
// JSON, so a 12 MB image (the admin-side hard cap, see netlify/lib/image-process.ts)
// inflates ~33% in transport — 20 MB leaves headroom for that + JSON envelope.
// nginx in front enforces 12 MB on the raw multipart side.
app.use(express.raw({ type: "*/*", limit: "20mb" }));
app.use((req, _res, next) => {
  if (Buffer.isBuffer(req.body) && req.body.length > 0) {
    req.body = req.body.toString("utf8");
  }
  next();
});

// --- 3. Discover and mount Netlify function handlers ---
interface Mounted {
  urlPath: string;
  file: string;
  handler: Handler;
}

async function mountAllFunctions(): Promise<Mounted[]> {
  const entries = fs.readdirSync(FUNCTIONS_DIR).filter((f) => f.endsWith(".ts"));
  const mounted: Mounted[] = [];

  for (const file of entries) {
    const name = file.replace(/\.ts$/, "");
    // Skip anything clearly internal/unused by URL (none currently, but guard).
    if (name.startsWith("_")) continue;

    // Import compiled JS. When running via tsx/node-ts both .ts and .js work;
    // after `tsc` build we'll have .js in dist/. Try .js first, fall back to .ts.
    const modPath = path.join(FUNCTIONS_DIR, name + ".ts");
    let mod: { handler?: Handler };
    try {
      mod = await import(modPath);
    } catch (err) {
      console.error(`[mount] failed to import ${file}:`, err);
      continue;
    }
    if (!mod.handler) {
      console.warn(`[mount] ${file} has no exported handler — skipping`);
      continue;
    }

    const urlPath = name.startsWith("admin-")
      ? "/api/admin/" + name.slice("admin-".length)
      : "/api/" + name;

    app.all(urlPath, toExpress(mod.handler));
    mounted.push({ urlPath, file, handler: mod.handler });
  }

  return mounted;
}

// --- 4. Static assets (served last, so /api/* takes precedence) ---
function mountStatic(): void {
  // Root static files (index.html, *.html, css/, js/, img/, etc.).
  app.use(express.static(PROJECT_ROOT, {
    extensions: ["html"],
    index: "index.html",
    setHeaders: (res, filePath) => {
      // Cache images/fonts aggressively; HTML short so updates propagate.
      if (/\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      } else if (/\.html$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=60");
      } else if (/\/admin\//i.test(filePath)) {
        // Admin JS/CSS — never trust browser cache. Owner edits land
        // immediately. Slightly heavier on bandwidth, worth it for sanity.
        res.setHeader("Cache-Control", "no-cache, must-revalidate");
      } else {
        res.setHeader("Cache-Control", "public, max-age=600");
      }
    },
  }));

  // Admin SPA lives under /admin/ — serve index.html on any /admin/* miss.
  app.get(/^\/admin(\/.*)?$/, (req, res, next) => {
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return next(); // already a file
    res.sendFile(path.join(PROJECT_ROOT, "admin", "index.html"));
  });

  // 404 fallback for anything else: serve the branded 404 page.
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "not-found", path: req.path });
    } else {
      res.status(404).sendFile(path.join(PROJECT_ROOT, "404.html"));
    }
  });
}

// --- 5. In-process cron (replaces Netlify scheduled functions) ---
async function scheduleCrons(mounted: Mounted[]): Promise<void> {
  const byName = new Map<string, Handler>();
  for (const m of mounted) {
    const key = m.file.replace(/\.ts$/, "");
    byName.set(key, m.handler);
  }

  async function invokeHandler(name: string, reason: string): Promise<void> {
    const handler = byName.get(name);
    if (!handler) {
      console.warn(`[cron] ${name} not mounted — skipping`);
      return;
    }
    console.log(`[cron] ${name} firing (${reason})`);
    try {
      const event = {
        rawUrl: `internal:///${name}`,
        rawQuery: "",
        path: `/${name}`,
        httpMethod: "POST",
        headers: {
          "x-internal-cron": "1",
          // Also pass the shared secret if set so cronGuard accepts the call
          // even if a future change splits scheduler + handler across processes.
          ...(process.env.CRON_SECRET ? { "x-cron-token": process.env.CRON_SECRET } : {}),
        },
        multiValueHeaders: {},
        queryStringParameters: {},
        multiValueQueryStringParameters: {},
        body: null,
        isBase64Encoded: false,
      } as Parameters<Handler>[0];
      const ctx = {
        functionName: name,
        invokedFunctionArn: "cron",
        memoryLimitInMB: "512",
        awsRequestId: "cron-" + Date.now(),
        getRemainingTimeInMillis: () => 60_000,
        done: () => {},
        fail: () => {},
        succeed: () => {},
        callbackWaitsForEmptyEventLoop: false,
        logGroupName: "cron",
        logStreamName: "cron",
        functionVersion: "1",
      } as unknown as Parameters<Handler>[1];
      await handler(event, ctx, () => {});
    } catch (err) {
      console.error(`[cron] ${name} threw:`, err);
    }
  }

  // Hourly reminder sweep.
  cron.schedule("0 * * * *", () => invokeHandler("cron-reminder", "hourly"), { timezone: "UTC" });
  // Daily digest at 18:00 UTC (matches netlify.toml).
  cron.schedule("0 18 * * *", () => invokeHandler("cron-daily-digest", "daily 18:00 UTC"), { timezone: "UTC" });
  // Hourly Google-review nudge — finds bookings that ended ~4h ago.
  cron.schedule("15 * * * *", () => invokeHandler("cron-review-nudge", "hourly :15"), { timezone: "UTC" });

  console.log("[cron] scheduled: reminder=hourly, daily-digest=18:00 UTC, review-nudge=hourly :15");
}

// --- 6. Boot ---
async function main(): Promise<void> {
  const mounted = await mountAllFunctions();
  console.log(`[mount] ${mounted.length} functions wired:`);
  for (const m of mounted) console.log(`  ${m.urlPath.padEnd(40)} ← ${m.file}`);

  mountStatic();

  // Always-on error middleware: returns sanitized JSON 500 instead of Express's
  // default HTML stack page. Sentry capture is conditional on SENTRY_DSN.
  app.use((err: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    if (process.env.SENTRY_DSN) Sentry.captureException(err);
    console.error("[server-error]", err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "internal", message: "Greška na serveru" });
  });

  await scheduleCrons(mounted);

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "127.0.0.1";
  app.listen(port, host, () => {
    console.log(`[boot] L'Essenza server listening on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
