/* eslint-disable no-console */
/**
 * One-shot migration: copy every key from Netlify Blobs into the self-hosted SQLite store.
 *
 * Usage (from the Mac/dev machine, not the server):
 *   NETLIFY_SITE_ID=xxxxxxxx NETLIFY_BLOBS_TOKEN=xxxxx \
 *   LESSENZA_DB_PATH=./migration.db \
 *   npx tsx deploy/migrate-from-blobs.ts
 *
 * Then scp migration.db onto the Hetzner server:
 *   scp migration.db  lessenza@your-server:/opt/lessenza/app/data/lessenza.db
 *
 * How to obtain the credentials:
 *   Netlify dashboard → Site settings → Blobs → "Create personal token"
 *   Site ID is visible under Site settings → General → Site information.
 */

import { getStore } from "@netlify/blobs";
import { SqliteStore, resolveDbPath } from "../server/storage-sqlite";

const DRY_RUN = process.argv.includes("--dry-run");

async function main(): Promise<void> {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteID || !token) {
    console.error("Set NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN.");
    console.error("  NETLIFY_SITE_ID: Netlify → Site settings → General → Site information → Site ID");
    console.error("  NETLIFY_BLOBS_TOKEN: Netlify → User settings → Applications → Personal access tokens → New");
    console.error("");
    console.error("Usage:");
    console.error("  NETLIFY_SITE_ID=xxx NETLIFY_BLOBS_TOKEN=yyy npx tsx deploy/migrate-from-blobs.ts");
    console.error("  Add --dry-run to list keys without writing anything.");
    process.exit(1);
  }

  const src = getStore({ name: "lessenza-config", consistency: "strong", siteID, token });
  const dbPath = resolveDbPath();

  console.log(`[migrate] source : Netlify Blobs (site ${siteID})`);
  console.log(`[migrate] target : SQLite at ${dbPath}${DRY_RUN ? " (DRY RUN — nothing will be written)" : ""}`);

  let listed: { blobs?: { key: string }[] };
  try {
    listed = (await src.list({ prefix: "" })) as { blobs?: { key: string }[] };
  } catch (err) {
    console.error(`[fail] cannot list Netlify Blobs: ${(err as Error).message}`);
    console.error("  Check your NETLIFY_SITE_ID is correct and the token has read scope.");
    process.exit(2);
  }
  const keys = (listed.blobs ?? []).map((b) => b.key).sort();
  console.log(`[migrate] found ${keys.length} keys`);

  const dst = DRY_RUN ? null : new SqliteStore(dbPath);

  // Categorize keys so the output is useful even on a dry run.
  const buckets = {
    "auth / admin":   [] as string[],
    "services":       [] as string[],
    "working-hours":  [] as string[],
    "settings":       [] as string[],
    "pairs":          [] as string[],
    "blocks":         [] as string[],
    "inquiries":      [] as string[],
    "day-notes":      [] as string[],
    "blocked-phones": [] as string[],
    "google-auth":    [] as string[],
    "reminders-sent": [] as string[],
    "rate-limit":     [] as string[],
    "other":          [] as string[],
  };
  const labelFor = (k: string): keyof typeof buckets => {
    if (k.startsWith("auth"))                 return "auth / admin";
    if (k.startsWith("services"))             return "services";
    if (k.startsWith("working-hours"))        return "working-hours";
    if (k.startsWith("settings"))             return "settings";
    if (k.startsWith("parallel-pairs"))       return "pairs";
    if (k.startsWith("blocks"))               return "blocks";
    if (k.startsWith("inquiry"))              return "inquiries";
    if (k.startsWith("day-note"))             return "day-notes";
    if (k.startsWith("blocked-phones"))       return "blocked-phones";
    if (k.startsWith("google-"))              return "google-auth";
    if (k.startsWith("reminders-sent"))       return "reminders-sent";
    if (k.startsWith("ratelimit") || k.startsWith("rl-")) return "rate-limit";
    return "other";
  };

  let ok = 0;
  let fail = 0;
  for (const key of keys) {
    buckets[labelFor(key)].push(key);
    try {
      const data = await src.get(key, { type: "json" });
      if (data == null) {
        console.warn(`[skip]  ${key}  (empty)`);
        continue;
      }
      if (!DRY_RUN) await dst!.setJSON(key, data);
      ok++;
    } catch (err) {
      fail++;
      console.error(`[fail]  ${key}: ${(err as Error).message}`);
    }
  }

  console.log("");
  console.log("[migrate] summary by category:");
  for (const [label, list] of Object.entries(buckets)) {
    if (list.length) console.log(`  ${label.padEnd(18)} ${list.length}`);
  }
  console.log("");
  console.log(`[done]  ${ok} ${DRY_RUN ? "would copy" : "copied"}, ${fail} failed`);

  if (dst) dst.close();
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
