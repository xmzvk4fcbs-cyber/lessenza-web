import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, verifyPassword, setAuth, getAuth } from "../../netlify/lib/auth";
import { setSettings, savePasswordResetToken } from "../../netlify/lib/config";
import { handler as requestHandler } from "../../netlify/functions/admin-password-reset-request";
import { handler as confirmHandler } from "../../netlify/functions/admin-password-reset-confirm";

function ev(path: string, body: unknown, ip = "1.2.3.4"): HandlerEvent {
  return {
    rawUrl: `https://example.com${path}`,
    rawQuery: "",
    path,
    httpMethod: "POST",
    headers: { "x-forwarded-for": ip },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as HandlerEvent;
}

describe("password reset", () => {
  beforeEach(async () => {
    // Ensure no env-managed auth interferes with the Blobs-backed flow.
    delete process.env.ADMIN_PASSWORD_HASH;
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("oldpw1234");
    await setSettings({ ownerEmail: "owner@example.com" });
  });

  it("request returns ok even for unknown email (no enumeration)", async () => {
    const r = await requestHandler(
      ev("/api/admin/password-reset-request", { email: "stranger@example.com" }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ ok: true });
  });

  it("confirm sets the new password when token is valid", async () => {
    const raw = "a".repeat(64);
    await savePasswordResetToken(raw);
    const r = await confirmHandler(
      ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew1" }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);
    expect(await verifyPassword("brandnew1")).toBe(true);
    expect(await verifyPassword("oldpw1234")).toBe(false);
  });

  it("confirm rejects expired token", async () => {
    const raw = "b".repeat(64);
    await savePasswordResetToken(raw, -5); // already expired
    const r = await confirmHandler(
      ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew1" }),
      {} as never
    );
    expect(r?.statusCode).toBe(401);
    expect(JSON.parse(r!.body as string).error).toBe("expired");
  });

  it("confirm rejects already-used token", async () => {
    const raw = "c".repeat(64);
    await savePasswordResetToken(raw);
    const ok = await confirmHandler(
      ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew1" }),
      {} as never
    );
    expect(ok?.statusCode).toBe(200);
    const reuse = await confirmHandler(
      ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew2" }),
      {} as never
    );
    expect(reuse?.statusCode).toBe(401);
    expect(JSON.parse(reuse!.body as string).error).toBe("used");
  });

  it("preserves TOTP secret + totpEnabled across reset", async () => {
    await setAuth({ totpSecret: "JBSWY3DPEHPK3PXP", totpEnabled: true });

    const raw = "d".repeat(64);
    await savePasswordResetToken(raw);
    const r = await confirmHandler(
      ev("/api/admin/password-reset-confirm", { token: raw, password: "newpw1234" }),
      {} as never
    );
    expect(r?.statusCode).toBe(200);

    const auth = await getAuth();
    expect(auth?.totpEnabled).toBe(true);
    expect(auth?.totpSecret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("returns invalid for unknown token even when a real one exists", async () => {
    const real = "e".repeat(64);
    await savePasswordResetToken(real);
    const junk = "0".repeat(64);
    const r = await confirmHandler(
      ev("/api/admin/password-reset-confirm", { token: junk, password: "newpw1234" }),
      {} as never
    );
    expect(r?.statusCode).toBe(401);
    expect(JSON.parse(r!.body as string).error).toBe("invalid");
  });
});
