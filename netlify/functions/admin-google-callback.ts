import type { Handler } from "@netlify/functions";
import { google } from "googleapis";
import { consumeState, getOAuth2Client, saveTokens } from "../lib/google-auth";

const html = (title: string, body: string) => ({
  statusCode: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
  body: `<!doctype html><html lang="sr"><head><meta charset="UTF-8"><title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; background:#F9F2E5; color:#4A4238; padding:2rem; max-width:520px; margin:3rem auto; }
      h1 { color:#6B6F4F; font-weight:500; }
      .card { background:#FBF8F2; padding:2rem; border-radius:16px; border:1px solid #D9C09A; box-shadow:0 18px 40px rgba(74,66,56,.08); }
      code { background:#FBEDEC; padding:2px 6px; border-radius:4px; }
      a { color:#C9A961; }
    </style></head><body><div class="card">${body}</div></body></html>`,
});

export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code || "";
  const state = event.queryStringParameters?.state || "";
  const err = event.queryStringParameters?.error;

  if (err) {
    return html("Greška", `<h1>Greška pri povezivanju</h1><p>Google je vratio grešku: <code>${err}</code></p><p><a href="/admin/#settings">Nazad u admin</a></p>`);
  }
  if (!code) {
    return html("Nedostaje code", `<h1>Nedostaje autorizacioni kod</h1><p><a href="/admin/#settings">Nazad u admin</a></p>`);
  }

  const stateOk = await consumeState(state);
  if (!stateOk) {
    return html("Nevazeci zahtjev", `<h1>Nevazeci ili istekao zahtjev</h1><p>Probaj ponovo iz admin panela.</p><p><a href="/admin/#settings">Nazad u admin</a></p>`);
  }

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return html("Greška", `<h1>Google nije vratio refresh token</h1><p>Idi u <a href="https://myaccount.google.com/permissions">Google dozvole</a>, ukloni "Lessenza" pa probaj ponovo — mora biti prva autorizacija.</p>`);
    }

    // Fetch user email for display/confirmation.
    let email: string | undefined;
    try {
      client.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: "v2", auth: client });
      const info = await oauth2.userinfo.get();
      email = info.data.email ?? undefined;
    } catch {
      // non-fatal
    }

    await saveTokens({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token ?? undefined,
      expiry_date: tokens.expiry_date ?? undefined,
      scope: tokens.scope ?? undefined,
      token_type: tokens.token_type ?? undefined,
      email,
      connectedAt: new Date().toISOString(),
    });

    return html("Uspjesno povezano", `
      <h1>✓ Google povezan</h1>
      <p>Nalog: <strong>${email || "(nepoznato)"}</strong></p>
      <p>Kalendar i email sad rade preko tvog naloga.</p>
      <p><a href="/admin/#settings">Nazad u admin</a></p>
    `);
  } catch (e) {
    return html("Greška", `<h1>Greška pri razmjeni tokena</h1><p><code>${(e as Error).message}</code></p>`);
  }
};
