import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import {
  isAdminInitialized,
  setupAdmin,
  verifyPassword,
  issueToken,
  verifyToken,
  buildSessionCookie,
  clearSessionCookie,
} from "../../netlify/lib/auth";

describe("auth", () => {
  beforeEach(() => {
    resetStoreForTests(new InMemoryStore());
  });

  it("isAdminInitialized false initially", async () => {
    expect(await isAdminInitialized()).toBe(false);
  });

  it("setupAdmin initializes auth and subsequent setup fails", async () => {
    await setupAdmin("correct-horse");
    expect(await isAdminInitialized()).toBe(true);
    await expect(setupAdmin("another")).rejects.toThrow(/already-initialized/);
  });

  it("verifyPassword true for correct password", async () => {
    await setupAdmin("s3cret-pass");
    expect(await verifyPassword("s3cret-pass")).toBe(true);
    expect(await verifyPassword("wrong")).toBe(false);
  });

  it("issueToken + verifyToken round-trip", async () => {
    await setupAdmin("pw");
    const token = await issueToken();
    const claims = await verifyToken(token);
    expect(claims.sub).toBe("admin");
  });

  it("verifyToken rejects garbage", async () => {
    await setupAdmin("pw");
    await expect(verifyToken("not-a-jwt")).rejects.toThrow();
  });

  it("buildSessionCookie has HttpOnly, Secure, SameSite=Strict, Path=/", () => {
    const c = buildSessionCookie("tok");
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/Secure/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).toMatch(/Path=\//);
  });

  it("clearSessionCookie sets Max-Age=0", () => {
    expect(clearSessionCookie()).toMatch(/Max-Age=0/);
  });
});
