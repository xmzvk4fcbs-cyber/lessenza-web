import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken, getAuth } from "../../netlify/lib/auth";
import { handler as setupHandler } from "../../netlify/functions/admin-totp-setup";
import { handler as enableHandler } from "../../netlify/functions/admin-totp-enable";
import { handler as disableHandler } from "../../netlify/functions/admin-totp-disable";
import { handler as loginHandler } from "../../netlify/functions/admin-login";
import { TOTP, Secret } from "otpauth";

function ev(path: string, method: string, body: unknown, cookie?: string): HandlerEvent {
  return {
    rawUrl: `https://example.com${path}`,
    rawQuery: "",
    path,
    httpMethod: method,
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    body: body !== undefined ? JSON.stringify(body) : null,
    isBase64Encoded: false,
  } as HandlerEvent;
}

async function bootstrap() {
  // Make sure no env-managed auth interferes with the Blobs-backed flow.
  delete process.env.ADMIN_PASSWORD_HASH;
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  const tok = await issueToken();
  const setupRes = await setupHandler(
    ev("/api/admin/totp-setup", "POST", {}, tok),
    {} as never
  );
  const { secret } = JSON.parse(setupRes!.body as string);
  return { tok, secret };
}

function totpFor(secret: string): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}

describe("TOTP 2FA", () => {
  beforeEach(() => {
    delete process.env.ADMIN_PASSWORD_HASH;
  });

  it("setup → enable → login requires code", async () => {
    const { tok, secret } = await bootstrap();
    const code = totpFor(secret);
    const en = await enableHandler(
      ev("/api/admin/totp-enable", "POST", { code }, tok),
      {} as never
    );
    expect(en?.statusCode).toBe(200);
    const auth = await getAuth();
    expect(auth?.totpEnabled).toBe(true);

    // Login without code → 401 totp-required
    const noCode = await loginHandler(
      ev("/api/admin/login", "POST", { password: "pw-12345678" }),
      {} as never
    );
    expect(noCode?.statusCode).toBe(401);
    expect(JSON.parse(noCode!.body as string).error).toBe("totp-required");

    // Login with bad code → 401 totp-invalid
    const badCode = await loginHandler(
      ev("/api/admin/login", "POST", { password: "pw-12345678", totp: "000000" }),
      {} as never
    );
    expect(badCode?.statusCode).toBe(401);
    expect(JSON.parse(badCode!.body as string).error).toBe("totp-invalid");

    // Login with valid code → 200
    const withCode = await loginHandler(
      ev("/api/admin/login", "POST", {
        password: "pw-12345678",
        totp: totpFor(secret),
      }),
      {} as never
    );
    expect(withCode?.statusCode).toBe(200);

    // Disable clears both flag and secret. Requires fresh proof — pass a
    // valid current TOTP code so the request is accepted.
    const off = await disableHandler(
      ev("/api/admin/totp-disable", "POST", { code: totpFor(secret) }, tok),
      {} as never
    );
    expect(off?.statusCode).toBe(200);
    const after = await getAuth();
    expect(after?.totpEnabled).toBe(false);
    expect(after?.totpSecret).toBeUndefined();
    // Login then succeeds without code.
    const passOnly = await loginHandler(
      ev("/api/admin/login", "POST", { password: "pw-12345678" }),
      {} as never
    );
    expect(passOnly?.statusCode).toBe(200);
  });

  it("rejects bad code on enable", async () => {
    const { tok } = await bootstrap();
    const r = await enableHandler(
      ev("/api/admin/totp-enable", "POST", { code: "000000" }, tok),
      {} as never
    );
    expect(r?.statusCode).toBe(401);
    const auth = await getAuth();
    // Secret was set by setup but enabled flag stays false until verified.
    expect(auth?.totpEnabled).toBe(false);
  });

  it("setup refuses when TOTP already enabled", async () => {
    const { tok, secret } = await bootstrap();
    const code = totpFor(secret);
    await enableHandler(ev("/api/admin/totp-enable", "POST", { code }, tok), {} as never);
    const setup2 = await setupHandler(ev("/api/admin/totp-setup", "POST", {}, tok), {} as never);
    expect(setup2?.statusCode).toBe(409);
    expect(JSON.parse(setup2!.body as string).error).toBe("already-enabled");
  });

  it("disable requires proof (TOTP code or password)", async () => {
    const { tok, secret } = await bootstrap();
    await enableHandler(
      ev("/api/admin/totp-enable", "POST", { code: totpFor(secret) }, tok),
      {} as never
    );
    const noProof = await disableHandler(
      ev("/api/admin/totp-disable", "POST", {}, tok),
      {} as never
    );
    expect(noProof?.statusCode).toBe(400);
    const bad = await disableHandler(
      ev("/api/admin/totp-disable", "POST", { code: "000000" }, tok),
      {} as never
    );
    expect(bad?.statusCode).toBe(401);
    const ok = await disableHandler(
      ev("/api/admin/totp-disable", "POST", { code: totpFor(secret) }, tok),
      {} as never
    );
    expect(ok?.statusCode).toBe(200);
    // password fallback: re-setup, re-enable, then disable with password
    const sec2 = JSON.parse(
      (await setupHandler(ev("/api/admin/totp-setup", "POST", {}, tok), {} as never))!
        .body as string
    ).secret;
    await enableHandler(
      ev("/api/admin/totp-enable", "POST", { code: totpFor(sec2) }, tok),
      {} as never
    );
    const pwOk = await disableHandler(
      ev("/api/admin/totp-disable", "POST", { password: "pw-12345678" }, tok),
      {} as never
    );
    expect(pwOk?.statusCode).toBe(200);
  });
});
