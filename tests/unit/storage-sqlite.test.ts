import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { SqliteStore } from "../../server/storage-sqlite";

describe("SqliteStore", () => {
  let tmpDir: string;
  let store: SqliteStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lessenza-test-"));
    store = new SqliteStore(path.join(tmpDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for missing keys", async () => {
    expect(await store.getJSON("nope")).toBeNull();
  });

  it("round-trips JSON values", async () => {
    await store.setJSON("a", { foo: "bar", n: 42 });
    const got = await store.getJSON<{ foo: string; n: number }>("a");
    expect(got).toEqual({ foo: "bar", n: 42 });
  });

  it("overwrites existing values", async () => {
    await store.setJSON("k", { v: 1 });
    await store.setJSON("k", { v: 2 });
    expect(await store.getJSON("k")).toEqual({ v: 2 });
  });

  it("deletes keys", async () => {
    await store.setJSON("k", { v: 1 });
    await store.delete("k");
    expect(await store.getJSON("k")).toBeNull();
  });

  it("list(prefix) returns only matching keys, sorted", async () => {
    await store.setJSON("inquiry-001.json", { id: "001" });
    await store.setJSON("inquiry-002.json", { id: "002" });
    await store.setJSON("day-note-2026-04-17.json", { text: "x" });
    await store.setJSON("settings", { v: 1 });
    const inquiries = await store.list("inquiry-");
    expect(inquiries).toEqual(["inquiry-001.json", "inquiry-002.json"]);
    const all = await store.list("");
    expect(all).toHaveLength(4);
  });

  it("list() treats %/_ in the prefix as literals (not SQL wildcards)", async () => {
    await store.setJSON("a_b", { v: 1 });
    await store.setJSON("axb", { v: 2 });
    const r = await store.list("a_");
    expect(r).toEqual(["a_b"]);
  });

  it("survives a close + reopen round-trip (WAL persists)", async () => {
    await store.setJSON("persisted", { ok: true });
    const p = path.join(tmpDir, "test.db");
    store.close();
    const again = new SqliteStore(p);
    expect(await again.getJSON("persisted")).toEqual({ ok: true });
    again.close();
  });

  it("handles unicode and special characters in keys", async () => {
    await store.setJSON("užitak", { v: 1 });
    await store.setJSON("a b/c:d.json", { v: 2 });
    expect(await store.getJSON("užitak")).toEqual({ v: 1 });
    expect(await store.getJSON("a b/c:d.json")).toEqual({ v: 2 });
  });

  it("returns null on corrupted value rows rather than throwing", async () => {
    // Simulate a corrupted row by going behind the KVStore API.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (store as any).db as import("better-sqlite3").Database;
    db.prepare("INSERT INTO kv(key, value, updated_at) VALUES(?, ?, ?)").run(
      "bad", "not-json-{}{[[]]}", Date.now()
    );
    expect(await store.getJSON("bad")).toBeNull();
  });
});
