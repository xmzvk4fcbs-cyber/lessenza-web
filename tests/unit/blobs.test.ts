import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, createConfigStore } from "../../netlify/lib/blobs";

describe("blobs InMemoryStore", () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it("round-trips JSON", async () => {
    await store.setJSON("a", { x: 1 });
    expect(await store.getJSON<{ x: number }>("a")).toEqual({ x: 1 });
  });

  it("returns null for missing key", async () => {
    expect(await store.getJSON("nope")).toBeNull();
  });

  it("delete removes key", async () => {
    await store.setJSON("a", { x: 1 });
    await store.delete("a");
    expect(await store.getJSON("a")).toBeNull();
  });

  it("list returns keys with prefix", async () => {
    await store.setJSON("inquiries/1", { n: 1 });
    await store.setJSON("inquiries/2", { n: 2 });
    await store.setJSON("other/z", {});
    const keys = await store.list("inquiries/");
    expect(keys.sort()).toEqual(["inquiries/1", "inquiries/2"]);
  });

  it("createConfigStore returns object with methods in test mode", () => {
    const s = createConfigStore({ testMode: true });
    expect(typeof s.getJSON).toBe("function");
    expect(typeof s.setJSON).toBe("function");
  });
});
