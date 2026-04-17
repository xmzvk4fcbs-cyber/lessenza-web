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

async function main(): Promise<void> {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;
  if (!siteID || !token) {
    console.error("Set NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN.");
    console.error("Get them from Netlify dashboard → Site settings → Blobs.");
    process.exit(1);
  }

  const src = getStore({ name: "lessenza-config", consistency: "strong", siteID, token });
  const dbPath = resolveDbPath();
  const dst = new SqliteStore(dbPath);

  console.log(`[migrate] source : Netlify Blobs (site ${siteID})`);
  console.log(`[migrate] target : SQLite at ${dbPath}`);

  const listed = (await src.list({ prefix: "" })) as { blobs?: { key: string }[] };
  const keys = (listed.blobs ?? []).map((b) => b.key);
  console.log(`[migrate] found ${keys.length} keys`);

  let ok = 0;
  let fail = 0;
  for (const key of keys) {
    try {
      const data = await src.get(key, { type: "json" });
      if (data == null) {
        console.warn(`[skip]  ${key}  (empty)`);
        continue;
      }
      await dst.setJSON(key, data);
      ok++;
      console.log(`[copy]  ${key}`);
    } catch (err) {
      fail++;
      console.error(`[fail]  ${key}: ${(err as Error).message}`);
    }
  }

  dst.close();
  console.log(`[done]  ${ok} copied, ${fail} failed`);
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
