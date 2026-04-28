# Product Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring L'Essenza Booking System to a productized state — automated backups, email deliverability, secure auth, GDPR-aware data handling, error monitoring, and operational polish — so it can be sold and run for multiple salons without weekly hand-holding.

**Architecture:** Five independent phases that can ship one at a time. Phase 1 is pure ops (no code) and unblocks the rest. Phases 2–5 reuse the existing Netlify Function / Express adapter pattern, Blobs/SQLite storage, Zod schemas, vitest, bcrypt+JWT session, and nodemailer.

**Tech Stack:** TypeScript (Node 20), Netlify Functions + Express adapter, Zod, vitest, Netlify Blobs / SQLite (`netlify/lib/blobs.ts`), bcrypt + JWT, nodemailer, sharp (new — Phase 5), `@sentry/node` (new — Phase 4 optional), `web-push` (new — Phase 5).

---

## Phase 1 — Critical Operations (no code, mostly DNS + bash)

### Task 1: Nightly SQLite + Blobs backup to Hetzner Storage Box

**Files:**
- Create: `deploy/nightly-backup.sh`
- Create: `deploy/lessenza-backup.service`
- Create: `deploy/lessenza-backup.timer`
- Modify: `docs/HETZNER-DEPLOY.md` — add backup setup section

- [ ] **Step 1: Create the backup script**

```bash
cat > /Users/vanja/Projects/lessenza/deploy/nightly-backup.sh <<'EOF'
#!/usr/bin/env bash
# Nightly backup of L'Essenza app data: SQLite DB + uploaded files (gallery, reviews).
# Pushes to a Hetzner Storage Box via rsync over SSH.
#
# Required env (in /etc/lessenza-backup.env, chmod 600):
#   BACKUP_HOST=u123456.your-storagebox.de
#   BACKUP_USER=u123456
#   BACKUP_KEY=/root/.ssh/storagebox_ed25519
#   BACKUP_REMOTE_DIR=/home/lessenza
#
# Local layout backed up:
#   /opt/lessenza/app/data/lessenza.db (+ -wal + -shm)
#   /opt/lessenza/app/uploads/  (gallery + review photos)

set -u
LOG=/var/log/lessenza-backup.log
APP_DIR=/opt/lessenza/app
ENV_FILE=/etc/lessenza-backup.env
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
SNAPSHOT_DIR="${APP_DIR}/data/snapshots/${TS}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[$(date -Iseconds)] missing ${ENV_FILE}" >> "${LOG}"
  exit 1
fi
# shellcheck disable=SC1090
source "${ENV_FILE}"

mkdir -p "${SNAPSHOT_DIR}"

# 1. SQLite atomic snapshot (works even while server is running thanks to WAL).
sudo -u lessenza sqlite3 "${APP_DIR}/data/lessenza.db" \
  ".backup '${SNAPSHOT_DIR}/lessenza.db'" \
  >> "${LOG}" 2>&1

# 2. Tar uploads (avoid touching live writes — sharp may be writing).
if [[ -d "${APP_DIR}/uploads" ]]; then
  sudo -u lessenza tar czf "${SNAPSHOT_DIR}/uploads.tar.gz" \
    -C "${APP_DIR}" uploads >> "${LOG}" 2>&1
fi

# 3. Push to Storage Box (rsync mirrors snapshots/, server keeps last 14 locally).
rsync -az --partial -e "ssh -i ${BACKUP_KEY} -o StrictHostKeyChecking=accept-new" \
  "${SNAPSHOT_DIR}/" \
  "${BACKUP_USER}@${BACKUP_HOST}:${BACKUP_REMOTE_DIR}/snapshots/${TS}/" \
  >> "${LOG}" 2>&1

# 4. Local rotation: keep last 14 snapshot dirs, drop older.
find "${APP_DIR}/data/snapshots" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +

echo "[$(date -Iseconds)] backup ${TS} done" >> "${LOG}"
EOF
chmod +x /Users/vanja/Projects/lessenza/deploy/nightly-backup.sh
```

- [ ] **Step 2: Create the systemd service unit**

```bash
cat > /Users/vanja/Projects/lessenza/deploy/lessenza-backup.service <<'EOF'
[Unit]
Description=L'Essenza nightly backup to Storage Box
After=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/lessenza/app/deploy/nightly-backup.sh
User=root
StandardOutput=append:/var/log/lessenza-backup.log
StandardError=append:/var/log/lessenza-backup.log
EOF
```

- [ ] **Step 3: Create the systemd timer (runs at 03:30 UTC daily)**

```bash
cat > /Users/vanja/Projects/lessenza/deploy/lessenza-backup.timer <<'EOF'
[Unit]
Description=Run lessenza-backup.service nightly at 03:30 UTC

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=10min
Persistent=true
Unit=lessenza-backup.service

[Install]
WantedBy=timers.target
EOF
```

- [ ] **Step 4: Document the one-time owner setup in `docs/HETZNER-DEPLOY.md`**

Append a new section:

```markdown
## 16. Nightly backup (Hetzner Storage Box)

Hetzner sells a dedicated 1TB Storage Box for €3.49/month. One-time setup:

1. Order Storage Box: https://www.hetzner.com/storage/storage-box → smallest tier.
2. In Storage Box admin → Settings → enable SSH support, paste the *server's* public SSH key (`cat /root/.ssh/id_ed25519.pub` from your VPS, or generate one with `ssh-keygen -t ed25519 -f /root/.ssh/storagebox_ed25519 -N ""`).
3. Note the host (e.g. `u123456.your-storagebox.de`) and user (`u123456`).
4. On the VPS create `/etc/lessenza-backup.env` (chmod 600):
   ```
   BACKUP_HOST=u123456.your-storagebox.de
   BACKUP_USER=u123456
   BACKUP_KEY=/root/.ssh/storagebox_ed25519
   BACKUP_REMOTE_DIR=/home/lessenza
   ```
5. Install the systemd unit + timer:
   ```bash
   cp /opt/lessenza/app/deploy/lessenza-backup.service /etc/systemd/system/
   cp /opt/lessenza/app/deploy/lessenza-backup.timer   /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now lessenza-backup.timer
   ```
6. Verify by running once manually: `systemctl start lessenza-backup.service` then `tail /var/log/lessenza-backup.log`.

Restore: `scp <user>@<host>:/home/lessenza/snapshots/<ts>/lessenza.db /opt/lessenza/app/data/lessenza.db && systemctl restart lessenza`.
```

- [ ] **Step 5: Commit**

```bash
git add deploy/nightly-backup.sh deploy/lessenza-backup.service deploy/lessenza-backup.timer docs/HETZNER-DEPLOY.md
git commit -m "feat(ops): nightly backup to Hetzner Storage Box (sqlite + uploads)"
git push
```

---

### Task 2: SPF / DKIM / DMARC for lessenza.me

**Files:**
- Modify: `docs/HETZNER-DEPLOY.md` — add an "Email deliverability" section

This task has zero code changes — it's three DNS TXT records at Namecheap. The owner does it, we document it.

- [ ] **Step 1: Document SPF record**

Append to `docs/HETZNER-DEPLOY.md`:

```markdown
## 17. Email deliverability (SPF / DKIM / DMARC)

Without these three TXT records on `lessenza.me`, automated emails (booking
confirmations, reminders, review nudges) frequently land in spam. Setup is one
visit to Namecheap → Domain List → lessenza.me → Advanced DNS → Add new record.

### SPF (declares which servers may send on behalf of lessenza.me)

| Type | Host | Value | TTL |
|---|---|---|---|
| TXT Record | @ | `v=spf1 include:spf.privateemail.com ~all` | Automatic |

(Already present from PrivateEmail setup — verify with `dig TXT lessenza.me +short`. If you also send through Gmail OAuth, replace with `v=spf1 include:spf.privateemail.com include:_spf.google.com ~all`.)

### DKIM (cryptographically signs outgoing email)

In PrivateEmail webmail panel → Settings → Mail Settings → DKIM → "Generate DKIM
key". You'll get something like:

| Type | Host | Value | TTL |
|---|---|---|---|
| TXT Record | default._domainkey | `v=DKIM1; k=rsa; p=MIGfMA0...AAAB` | Automatic |

Paste at Namecheap exactly as PrivateEmail provides — no quotes, no line breaks.

### DMARC (policy + reporting)

| Type | Host | Value | TTL |
|---|---|---|---|
| TXT Record | _dmarc | `v=DMARC1; p=quarantine; rua=mailto:info@lessenza.me; pct=100` | Automatic |

Start with `p=quarantine` for the first 2 weeks; tighten to `p=reject` after monitoring `rua=` reports.

### Verify

1. Wait 1 hour for propagation.
2. Send a test booking confirmation to a Gmail address.
3. Open the message → "Show original" → check `Authentication-Results: ... spf=pass dkim=pass dmarc=pass`.
4. Or run https://www.mail-tester.com — paste the address it gives you, send from booking flow, check the score (target ≥ 9 / 10).
```

- [ ] **Step 2: Commit**

```bash
git add docs/HETZNER-DEPLOY.md
git commit -m "docs(deploy): SPF/DKIM/DMARC setup for lessenza.me"
git push
```

---

### Task 3: Fix the long-running `bufferMinutes` test failure

**Files:**
- Test: `tests/unit/schemas.test.ts` (around line 56)

Existing failure: assertion `expect(r.bufferMinutes).toBe(5)` but the schema default is `0`. Either the assertion is stale (default changed) or the default should be 5. The current default in `netlify/lib/schemas.ts:76` is `bufferMinutes: z.number().int().min(0).max(120).default(0)`. The test is wrong — buffer between appointments is intentionally `0` minutes by default; only owners who care set a non-zero buffer.

- [ ] **Step 1: Read the failing test to confirm the line**

Run: `npm run test -- tests/unit/schemas.test.ts 2>&1 | head -30`
Expected: failure on `expect(r.bufferMinutes).toBe(5)`.

- [ ] **Step 2: Fix the assertion to match the actual default**

Open `tests/unit/schemas.test.ts`, find the line that reads:

```ts
expect(r.bufferMinutes).toBe(5);
```

Change it to:

```ts
expect(r.bufferMinutes).toBe(0);
```

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`
Expected: all tests pass (no more "1 failed").

- [ ] **Step 4: Commit**

```bash
git add tests/unit/schemas.test.ts
git commit -m "test(schemas): bufferMinutes default is 0, not 5"
git push
```

---

## Phase 2 — Auth & security

### Task 4: Password reset flow

**Files:**
- Modify: `netlify/lib/schemas.ts` — add `PasswordResetTokenSchema`
- Modify: `netlify/lib/config.ts` — add token store accessors
- Modify: `netlify/lib/email-templates.ts` — add `passwordResetEmail`
- Create: `netlify/functions/admin-password-reset-request.ts`
- Create: `netlify/functions/admin-password-reset-confirm.ts`
- Create: `admin/reset.html` (the link target)
- Modify: `admin/index.html` — add "Zaboravljena lozinka?" link to login view
- Modify: `admin/admin.js` — wire the link
- Test: `tests/unit/password-reset-token.test.ts` (token verify)
- Test: `tests/integration/admin-password-reset.test.ts` (request + confirm round-trip)

- [ ] **Step 1: Add the token schema**

Append to `netlify/lib/schemas.ts` near `AdminAuthSchema`:

```ts
export const PasswordResetTokenSchema = z.object({
  /** Random URL-safe token (32 bytes hex). */
  token: z.string().min(32).max(128),
  /** SHA-256 hash of the token; only the hash is stored, never the raw value. */
  tokenHash: z.string().length(64),
  /** ISO timestamp when the token was issued. */
  issuedAt: z.string().datetime(),
  /** ISO timestamp when the token stops working. */
  expiresAt: z.string().datetime(),
  /** ISO timestamp when consumed; absent if still pending. */
  usedAt: z.string().datetime().optional(),
});
export type PasswordResetToken = z.infer<typeof PasswordResetTokenSchema>;
```

- [ ] **Step 2: Add token store accessors to config.ts**

Append to `netlify/lib/config.ts`:

```ts
import { PasswordResetTokenSchema, type PasswordResetToken } from "./schemas";
import { createHash } from "node:crypto";

const KEY_PASSWORD_RESET = "auth/password-reset.json";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function savePasswordResetToken(token: string, ttlMinutes = 30): Promise<PasswordResetToken> {
  const now = new Date();
  const entry: PasswordResetToken = {
    token: "",            // never persisted
    tokenHash: hashToken(token),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60 * 1000).toISOString(),
  };
  // Strip the raw token before persisting.
  const persisted = { ...entry, token: "" };
  await store().setJSON(KEY_PASSWORD_RESET, PasswordResetTokenSchema.parse(persisted));
  return entry;
}

export async function consumePasswordResetToken(token: string): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "used" }> {
  const raw = await store().getJSON<unknown>(KEY_PASSWORD_RESET);
  if (!raw) return { ok: false, reason: "invalid" };
  const r = PasswordResetTokenSchema.safeParse(raw);
  if (!r.success) return { ok: false, reason: "invalid" };
  const rec = r.data;
  if (rec.usedAt) return { ok: false, reason: "used" };
  if (Date.now() > new Date(rec.expiresAt).getTime()) return { ok: false, reason: "expired" };
  if (rec.tokenHash !== hashToken(token)) return { ok: false, reason: "invalid" };
  // Mark used.
  await store().setJSON(KEY_PASSWORD_RESET, PasswordResetTokenSchema.parse({ ...rec, usedAt: new Date().toISOString() }));
  return { ok: true };
}
```

- [ ] **Step 3: Add the email template**

Append to `netlify/lib/email-templates.ts`:

```ts
export function passwordResetEmail(opts: { to: string; resetUrl: string }): EmailMessage {
  const inner = [
    paragraph(`Zatraženo je resetovanje lozinke za admin panel L'Essenze.`),
    paragraph(`Klikni dugme dolje u narednih 30 minuta da postaviš novu lozinku:`),
    btnLink(opts.resetUrl, "Resetuj lozinku"),
    softNote(`Ako nisi ti zatražila reset, ignoriši ovaj email — niko ne može pristupiti panelu bez ovog linka.`),
    signOff(),
  ].join("\n");
  return {
    to: opts.to,
    subject: "L'Essenza — Resetovanje admin lozinke",
    text:
      `Zatraženo je resetovanje lozinke.\n\n` +
      `Otvori: ${opts.resetUrl}\n` +
      `Link važi 30 minuta.\n\n` +
      `Ako nisi ti — ignoriši.\n\n— L'Essenza`,
    html: renderShell({ heading: "Resetovanje lozinke", preheader: "Link važi 30 minuta", inner }),
  };
}
```

- [ ] **Step 4: Implement the request endpoint**

Create `netlify/functions/admin-password-reset-request.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { getSettings, savePasswordResetToken } from "../lib/config";
import { getMailerAsync } from "../lib/mailer";
import { passwordResetEmail } from "../lib/email-templates";
import { randomBytes } from "node:crypto";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "pwd-reset", limit: 3, windowSeconds: 3600 });
  if (!rl.allowed) return json({ error: "rate-limited" }, 429);

  let body: { email?: unknown };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return badRequest("missing-email", "email required");

  const settings = await getSettings();
  // Always return ok — never reveal whether ownerEmail matches (avoids enumeration).
  const isOwner = settings.ownerEmail && email === settings.ownerEmail.toLowerCase();
  if (!isOwner) return json({ ok: true });

  const raw = randomBytes(32).toString("hex"); // 64-char URL-safe token
  await savePasswordResetToken(raw);
  const siteUrl = (process.env.SITE_URL || "https://lessenza.me").replace(/\/$/, "");
  const resetUrl = `${siteUrl}/admin/reset.html?t=${encodeURIComponent(raw)}`;

  try {
    const mailer = await getMailerAsync(settings);
    await mailer.send(passwordResetEmail({ to: settings.ownerEmail!, resetUrl }));
  } catch (e) {
    console.error("[password-reset] email send failed:", (e as Error).message);
  }
  return json({ ok: true });
};
```

- [ ] **Step 5: Implement the confirm endpoint**

Create `netlify/functions/admin-password-reset-confirm.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson, unauthorized } from "../lib/http";
import { consumePasswordResetToken } from "../lib/config";
import { setupAdmin, isAdminInitialized } from "../lib/auth";
import { rateLimitAllow, clientIP } from "../lib/rate-limit";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const ip = clientIP(event.headers as Record<string, string | undefined>);
  const rl = await rateLimitAllow(ip, { key: "pwd-reset-confirm", limit: 10, windowSeconds: 3600 });
  if (!rl.allowed) return json({ error: "rate-limited" }, 429);

  let body: { token?: unknown; password?: unknown };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!token) return badRequest("missing-token", "token required");
  if (password.length < 8) return badRequest("password-too-short", "Password must be at least 8 characters");

  const r = await consumePasswordResetToken(token);
  if (!r.ok) return unauthorized(r.reason);

  // setupAdmin always overwrites; safe whether or not admin was initialized.
  await setupAdmin(password);
  return json({ ok: true });
};
```

- [ ] **Step 6: Build the public reset page**

Create `admin/reset.html`:

```html
<!DOCTYPE html>
<html lang="sr-Latn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset lozinke — L'Essenza Admin</title>
  <meta name="robots" content="noindex,nofollow">
  <link rel="stylesheet" href="admin.css">
</head>
<body class="admin-body">
  <main id="app">
    <section class="admin-view">
      <div class="admin-card">
        <h1>Nova lozinka</h1>
        <form id="reset-form">
          <div class="field">
            <label for="new-pw">Nova lozinka (min. 8)</label>
            <input id="new-pw" type="password" minlength="8" required autofocus>
          </div>
          <button type="submit" class="btn btn-primary block">Postavi novu lozinku</button>
          <p class="admin-error" id="reset-error" hidden></p>
        </form>
      </div>
    </section>
  </main>
  <script>
    const params = new URLSearchParams(location.search);
    const token = params.get("t") || "";
    document.getElementById("reset-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = document.getElementById("reset-error");
      err.hidden = true;
      const password = document.getElementById("new-pw").value;
      const r = await fetch("/api/admin/password-reset-confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        location.href = "/admin/";
      } else {
        err.textContent = body.message || body.error || "Greška";
        err.hidden = false;
      }
    });
  </script>
</body>
</html>
```

- [ ] **Step 7: Add "Zaboravljena lozinka?" link in login view**

In `admin/index.html`, find the existing login form (`<form id="login-form">`) and add a link below the submit button:

```html
<button type="submit" class="btn btn-primary block">Prijavi se</button>
<p style="text-align:center;margin-top:1rem;font-size:0.9rem;">
  <a href="#" id="forgot-pw-link" style="color:var(--gold,#c9a96e);">Zaboravljena lozinka?</a>
</p>
<p class="admin-error" id="login-error" hidden></p>
```

- [ ] **Step 8: Wire the forgot-password link in admin.js**

Append in `admin/admin.js` (near the existing login-form handler):

```js
const forgotLink = document.getElementById("forgot-pw-link");
if (forgotLink) {
  forgotLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const email = prompt("Unesi tvoj admin email — poslaće se link za reset.");
    if (!email) return;
    const r = await fetch("/api/admin/password-reset-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (r.ok) alert("Ako je email tačan, link je poslat. Provjeri inbox.");
    else alert("Greška. Probaj ponovo.");
  });
}
```

- [ ] **Step 9: Write integration tests**

Create `tests/integration/admin-password-reset.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, verifyPassword } from "../../netlify/lib/auth";
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
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("oldpw1234");
    await setSettings({ ownerEmail: "owner@example.com" });
  });

  it("request returns ok even for unknown email (no enumeration)", async () => {
    const r = await requestHandler(ev("/api/admin/password-reset-request", { email: "stranger@example.com" }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(JSON.parse(r!.body as string)).toEqual({ ok: true });
  });

  it("confirm sets the new password when token is valid", async () => {
    const raw = "a".repeat(64);
    await savePasswordResetToken(raw);
    const r = await confirmHandler(ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew1" }), {} as never);
    expect(r?.statusCode).toBe(200);
    expect(await verifyPassword("brandnew1")).toBe(true);
  });

  it("confirm rejects expired token", async () => {
    const raw = "b".repeat(64);
    await savePasswordResetToken(raw, -5); // already expired
    const r = await confirmHandler(ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew1" }), {} as never);
    expect(r?.statusCode).toBe(401);
    expect(JSON.parse(r!.body as string).error).toBe("expired");
  });

  it("confirm rejects already-used token", async () => {
    const raw = "c".repeat(64);
    await savePasswordResetToken(raw);
    const ok = await confirmHandler(ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew1" }), {} as never);
    expect(ok?.statusCode).toBe(200);
    const reuse = await confirmHandler(ev("/api/admin/password-reset-confirm", { token: raw, password: "brandnew2" }), {} as never);
    expect(reuse?.statusCode).toBe(401);
    expect(JSON.parse(reuse!.body as string).error).toBe("used");
  });
});
```

Run: `npm run test -- tests/integration/admin-password-reset.test.ts`
Expected: 4 tests pass.

- [ ] **Step 10: Commit**

```bash
git add netlify/lib/schemas.ts netlify/lib/config.ts netlify/lib/email-templates.ts \
        netlify/functions/admin-password-reset-request.ts netlify/functions/admin-password-reset-confirm.ts \
        admin/reset.html admin/index.html admin/admin.js \
        tests/integration/admin-password-reset.test.ts
git commit -m "feat(auth): self-serve password reset via email link (30min TTL)"
git push
```

---

### Task 5: TOTP-based 2FA

**Files:**
- Modify: `package.json` — add `otpauth` dependency
- Modify: `netlify/lib/schemas.ts` — extend `AdminAuthSchema`
- Modify: `netlify/lib/auth.ts` — add `totpVerify`, expose `getAuth`
- Create: `netlify/functions/admin-totp-setup.ts` — generate secret + return otpauth URL
- Create: `netlify/functions/admin-totp-enable.ts` — verify code + flip flag
- Create: `netlify/functions/admin-totp-disable.ts`
- Modify: `netlify/functions/admin-login.ts` — second-step TOTP gate
- Modify: `admin/index.html` — TOTP code input on login + setup card in Podešavanja
- Modify: `admin/admin.js` — handle two-step login
- Modify: `admin/tabs/settings.js` — render TOTP setup card with QR
- Test: `tests/integration/admin-totp.test.ts`

- [ ] **Step 1: Install `otpauth`**

```bash
cd /Users/vanja/Projects/lessenza
npm install otpauth
```

- [ ] **Step 2: Extend AdminAuthSchema**

In `netlify/lib/schemas.ts`, replace the existing `AdminAuthSchema`:

```ts
export const AdminAuthSchema = z.object({
  passwordHash: z.string(),
  jwtSecret: z.string(),
  createdAt: z.string().datetime(),
  /** Base32 TOTP secret. Absent until owner enables 2FA. */
  totpSecret: z.string().optional(),
  /** When true, TOTP code is required at login. */
  totpEnabled: z.boolean().default(false),
});
export type AdminAuth = z.infer<typeof AdminAuthSchema>;
```

- [ ] **Step 3: Add TOTP helpers to auth.ts**

Open `netlify/lib/auth.ts`. Find the existing `verifyPassword` function. After it, append:

```ts
import { TOTP, Secret } from "otpauth";

/** Returns the raw AdminAuth blob (for endpoints that need totp* fields). */
export async function getAuth(): Promise<AdminAuth | null> {
  const raw = await store().getJSON<unknown>("auth/admin.json");
  if (!raw) return null;
  const r = AdminAuthSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export async function setAuth(patch: Partial<AdminAuth>): Promise<void> {
  const cur = await getAuth();
  if (!cur) throw new Error("admin not initialized");
  const next = AdminAuthSchema.parse({ ...cur, ...patch });
  await store().setJSON("auth/admin.json", next);
}

export function totpVerify(secretBase32: string, code: string): boolean {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) return false;
  const totp = new TOTP({ secret: Secret.fromBase32(secretBase32), digits: 6, period: 30 });
  // Allow ±1 window of clock skew.
  return totp.validate({ token: code, window: 1 }) !== null;
}

export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

export function buildOtpauthUrl(secretBase32: string, label: string, issuer = "L'Essenza"): string {
  return new TOTP({
    secret: Secret.fromBase32(secretBase32),
    label,
    issuer,
    digits: 6,
    period: 30,
  }).toString();
}
```

- [ ] **Step 4: TOTP setup endpoint**

Create `netlify/functions/admin-totp-setup.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { generateTotpSecret, buildOtpauthUrl, getAuth, setAuth } from "../lib/auth";
import { getSettings } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  const auth = await getAuth();
  if (!auth) return json({ error: "not-initialized" }, 409);
  // Generate a fresh secret each time the owner clicks "Setup 2FA". Never
  // confirmed → still rotatable. Confirmed → next setup overwrites only on
  // explicit owner intent (we don't auto-disable existing TOTP here).
  const secret = generateTotpSecret();
  await setAuth({ totpSecret: secret });
  const settings = await getSettings();
  const label = settings.ownerEmail || "admin@lessenza.me";
  return json({
    secret,
    otpauthUrl: buildOtpauthUrl(secret, label),
  });
};

export const handler = adminGuard(inner);
```

- [ ] **Step 5: TOTP enable endpoint**

Create `netlify/functions/admin-totp-enable.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, unauthorized, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getAuth, setAuth, totpVerify } from "../lib/auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { code?: unknown };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) return badRequest("missing-code", "code required");
  const auth = await getAuth();
  if (!auth?.totpSecret) return badRequest("no-secret", "Run /api/admin/totp-setup first");
  if (!totpVerify(auth.totpSecret, code)) return unauthorized("bad-code");
  await setAuth({ totpEnabled: true });
  return json({ ok: true });
};

export const handler = adminGuard(inner);
```

- [ ] **Step 6: TOTP disable endpoint**

Create `netlify/functions/admin-totp-disable.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { setAuth } from "../lib/auth";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  await setAuth({ totpEnabled: false, totpSecret: undefined });
  return json({ ok: true });
};

export const handler = adminGuard(inner);
```

- [ ] **Step 7: Modify admin-login.ts to require TOTP when enabled**

Open `netlify/functions/admin-login.ts`. Find where it issues the session token after successful password verify. Replace that block with:

```ts
const auth = await getAuth();
if (auth?.totpEnabled) {
  // First step: password OK, but client must supply TOTP code.
  const code = typeof body.totp === "string" ? body.totp.trim() : "";
  if (!code) {
    return json({ error: "totp-required", message: "Unesi 6-cifreni kod iz Authenticator-a" }, 401);
  }
  if (!totpVerify(auth.totpSecret!, code)) {
    return json({ error: "totp-invalid", message: "Pogrešan 2FA kod" }, 401);
  }
}
// ...existing token-issue / set-cookie code stays the same below this point.
```

(Add the necessary imports at the top: `import { getAuth, totpVerify } from "../lib/auth";`)

- [ ] **Step 8: Update login UI for two-step flow**

In `admin/index.html` login view, add (right above the submit button):

```html
<div class="field" id="totp-field" hidden>
  <label for="login-totp">2FA kod (6 cifara)</label>
  <input id="login-totp" type="text" inputmode="numeric" maxlength="6" pattern="\d{6}" autocomplete="one-time-code">
</div>
```

In `admin/admin.js`, replace the login-form submit handler with:

```js
document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  err.hidden = true;
  const password = document.getElementById("login-password").value;
  const totpEl = document.getElementById("login-totp");
  const totp = totpEl?.value || "";
  const { ok, data } = await api("/api/admin/login", { method: "POST", body: { password, totp } });
  if (!ok) {
    if (data.error === "totp-required") {
      document.getElementById("totp-field").hidden = false;
      totpEl?.focus();
    } else {
      err.textContent = data.message || "Pogrešna lozinka.";
      err.hidden = false;
    }
    return;
  }
  show("home");
  await initAdmin();
});
```

- [ ] **Step 9: 2FA setup card in Podešavanja**

At the end of `admin/tabs/settings.js`, append:

```js
async function renderTotpCard() {
  const host = document.getElementById("totp-host");
  if (!host) return;
  let session;
  try { session = await must("/api/admin/session"); } catch { return; }
  const enabled = !!session.totpEnabled;
  host.innerHTML = enabled
    ? `<section class="stack-card"><div class="stack-card__head"><div>
         <div class="stack-card__title">2FA (Authenticator)</div>
         <div class="stack-card__meta">Uključeno · pri svakom loginu traži 6-cifreni kod.</div>
       </div></div>
       <button class="btn btn-ghost" id="totp-disable">Isključi 2FA</button>
       </section>`
    : `<section class="stack-card"><div class="stack-card__head"><div>
         <div class="stack-card__title">2FA (Authenticator)</div>
         <div class="stack-card__meta">Isključeno · samo lozinka štiti panel.</div>
       </div></div>
       <button class="btn btn-primary" id="totp-setup">Uključi 2FA</button>
       </section>`;
  const setup = document.getElementById("totp-setup");
  if (setup) setup.addEventListener("click", openTotpSetup);
  const disable = document.getElementById("totp-disable");
  if (disable) disable.addEventListener("click", async () => {
    if (!confirm("Sigurno isključiti 2FA?")) return;
    await must("/api/admin/totp-disable", { method: "POST", body: {} });
    toast("2FA isključeno.", "success");
    await renderTotpCard();
  });
}

async function openTotpSetup() {
  const r = await must("/api/admin/totp-setup", { method: "POST", body: {} });
  // Render QR code via free Google Charts API (no extra dep).
  const qr = `https://chart.googleapis.com/chart?chs=240x240&cht=qr&chl=${encodeURIComponent(r.otpauthUrl)}`;
  openModal("Uključi 2FA", `
    <p>1. Otvori <strong>Google Authenticator</strong> ili <strong>Authy</strong> na telefonu.</p>
    <p>2. Skeniraj QR kod ili ručno upiši tajnu.</p>
    <p style="text-align:center;"><img src="${qr}" alt="QR" style="max-width:240px;width:100%;height:auto;"></p>
    <p style="font-family:monospace;text-align:center;font-size:0.95rem;color:var(--sage);word-break:break-all;">${escapeHtml(r.secret)}</p>
    <div class="field">
      <label for="totp-confirm">Unesi 6-cifreni kod iz aplikacije</label>
      <input id="totp-confirm" type="text" inputmode="numeric" maxlength="6" pattern="\\d{6}" autofocus>
    </div>
    <div class="stack-card__actions">
      <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
      <button class="btn btn-primary" type="button" id="totp-confirm-btn">Potvrdi</button>
    </div>
  `);
  document.getElementById("totp-confirm-btn").addEventListener("click", async () => {
    const code = document.getElementById("totp-confirm").value.trim();
    try {
      await must("/api/admin/totp-enable", { method: "POST", body: { code } });
      closeModal();
      toast("2FA aktivirano.", "success");
      await renderTotpCard();
    } catch (e) { toast(e.message || "Pogrešan kod", "error"); }
  });
}
```

Then in the existing `render()` function, after `renderBlocked()` add:

```js
await renderTotpCard();
```

And in `admin/index.html` add a host div near the password change form:

```html
<div id="totp-host"></div>
```

- [ ] **Step 10: Modify session endpoint to expose `totpEnabled`**

In `netlify/functions/admin-session.ts`, find the response shape and add `totpEnabled`:

```ts
return json({
  initialized: !!auth,
  authenticated: !!sessionUser,
  totpEnabled: !!auth?.totpEnabled,
});
```

- [ ] **Step 11: Integration test for the round-trip**

Create `tests/integration/admin-totp.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken, getAuth } from "../../netlify/lib/auth";
import { handler as setupHandler } from "../../netlify/functions/admin-totp-setup";
import { handler as enableHandler } from "../../netlify/functions/admin-totp-enable";
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
  resetStoreForTests(new InMemoryStore());
  await setupAdmin("pw-12345678");
  const tok = await issueToken();
  const setupRes = await setupHandler(ev("/api/admin/totp-setup", "POST", {}, tok), {} as never);
  const { secret } = JSON.parse(setupRes!.body as string);
  return { tok, secret };
}

function totpFor(secret: string): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();
}

describe("TOTP 2FA", () => {
  it("setup → enable → login requires code", async () => {
    const { tok, secret } = await bootstrap();
    const code = totpFor(secret);
    const en = await enableHandler(ev("/api/admin/totp-enable", "POST", { code }, tok), {} as never);
    expect(en?.statusCode).toBe(200);
    const auth = await getAuth();
    expect(auth?.totpEnabled).toBe(true);
    // login without code → 401 totp-required
    const noCode = await loginHandler(ev("/api/admin/login", "POST", { password: "pw-12345678" }), {} as never);
    expect(noCode?.statusCode).toBe(401);
    expect(JSON.parse(noCode!.body as string).error).toBe("totp-required");
    // login with valid code → 200
    const withCode = await loginHandler(ev("/api/admin/login", "POST", { password: "pw-12345678", totp: totpFor(secret) }), {} as never);
    expect(withCode?.statusCode).toBe(200);
  });

  it("rejects bad code on enable", async () => {
    const { tok } = await bootstrap();
    const r = await enableHandler(ev("/api/admin/totp-enable", "POST", { code: "000000" }, tok), {} as never);
    expect(r?.statusCode).toBe(401);
  });
});
```

Run: `npm run test -- tests/integration/admin-totp.test.ts`
Expected: 2 tests pass.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json netlify/lib/schemas.ts netlify/lib/auth.ts \
        netlify/functions/admin-totp-setup.ts netlify/functions/admin-totp-enable.ts \
        netlify/functions/admin-totp-disable.ts netlify/functions/admin-login.ts \
        netlify/functions/admin-session.ts \
        admin/index.html admin/admin.js admin/tabs/settings.js \
        tests/integration/admin-totp.test.ts
git commit -m "feat(auth): TOTP 2FA — setup/enable/disable + two-step login"
git push
```

---

## Phase 3 — Data & GDPR

### Task 6: Cancellation log

**Files:**
- Modify: `netlify/lib/schemas.ts` — add `CancellationLogEntrySchema`
- Modify: `netlify/lib/config.ts` — add log accessors
- Modify: `netlify/functions/admin-cancel-booking.ts` — append to log
- Modify: `netlify/functions/admin-reject-booking.ts` — append to log
- Modify: `netlify/functions/public-cancel.ts` — append to log
- Modify: `netlify/functions/admin-no-show.ts` — append to log
- Create: `netlify/functions/admin-cancellations.ts` — GET endpoint
- Modify: `netlify/lib/stats.ts` — include cancellation count in monthly summary
- Test: `tests/integration/admin-cancellations.test.ts`

- [ ] **Step 1: Add the schema**

In `netlify/lib/schemas.ts`, near the other log-style schemas:

```ts
export const CancellationLogEntrySchema = z.object({
  /** Google Calendar event id at the time of cancellation. */
  eventId: z.string().min(1).max(200),
  /** When the appointment was scheduled (its startISO). */
  appointmentISO: z.string().datetime(),
  /** When this cancellation was recorded. */
  cancelledAt: z.string().datetime(),
  /** Who triggered it. */
  kind: z.enum(["by-client", "by-admin", "rejected", "no-show"]),
  /** Optional human reason (admin-supplied). */
  reason: z.string().max(200).optional(),
  name: z.string().max(120).optional(),
  phoneE164: z.string().max(32).optional(),
  serviceName: z.string().max(80).optional(),
});
export type CancellationLogEntry = z.infer<typeof CancellationLogEntrySchema>;
export const CancellationLogSchema = z.array(CancellationLogEntrySchema);
```

- [ ] **Step 2: Add the store accessors**

Append to `netlify/lib/config.ts`:

```ts
import { CancellationLogSchema, type CancellationLogEntry } from "./schemas";

const KEY_CANCEL_LOG = "history/cancellations.json";

export async function getCancellationLog(): Promise<CancellationLogEntry[]> {
  const raw = await store().getJSON<unknown>(KEY_CANCEL_LOG);
  if (!raw) return [];
  const r = CancellationLogSchema.safeParse(raw);
  return r.success ? r.data : [];
}

export async function appendCancellation(entry: CancellationLogEntry): Promise<void> {
  // Cap at 5000 entries — older ones rotate out (one-person salon, ~1000/year).
  const cur = await getCancellationLog();
  const next = [entry, ...cur].slice(0, 5000);
  await store().setJSON(KEY_CANCEL_LOG, CancellationLogSchema.parse(next));
}
```

- [ ] **Step 3: Hook into admin-cancel-booking.ts**

Open `netlify/functions/admin-cancel-booking.ts`. Find the line where the calendar event is deleted (`await cal.deleteEvent(eventId);` or similar). Right after the delete + before the email send, add:

```ts
import { appendCancellation } from "../lib/config";

// ...

await appendCancellation({
  eventId,
  appointmentISO: booking.startISO,
  cancelledAt: new Date().toISOString(),
  kind: "by-admin",
  reason: typeof reason === "string" ? reason : undefined,
  name: booking.name,
  phoneE164: booking.phoneE164,
  serviceName: booking.serviceName,
});
```

- [ ] **Step 4: Hook into admin-reject-booking.ts**

Same pattern: import `appendCancellation` and call after delete with `kind: "rejected"`.

- [ ] **Step 5: Hook into public-cancel.ts**

After `await cal.deleteEvent(v.eventId);`:

```ts
await appendCancellation({
  eventId: v.eventId,
  appointmentISO: booking.startISO,
  cancelledAt: new Date().toISOString(),
  kind: "by-client",
  name: booking.name,
  phoneE164: booking.phoneE164,
  serviceName: booking.serviceName,
});
```

- [ ] **Step 6: Hook into admin-no-show.ts**

After `await recordNoShow(...)`:

```ts
await appendCancellation({
  eventId,
  appointmentISO: booking.startISO,
  cancelledAt: new Date().toISOString(),
  kind: "no-show",
  name: booking.name,
  phoneE164: booking.phoneE164,
  serviceName: booking.serviceName,
});
```

- [ ] **Step 7: GET endpoint**

Create `netlify/functions/admin-cancellations.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { getCancellationLog } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  const from = event.queryStringParameters?.from || "";
  const to   = event.queryStringParameters?.to   || "";
  const log = await getCancellationLog();
  const filtered = log.filter((e) => {
    if (from && e.cancelledAt < from) return false;
    if (to   && e.cancelledAt > to)   return false;
    return true;
  });
  return json({ cancellations: filtered });
};

export const handler = adminGuard(inner);
```

- [ ] **Step 8: Surface in monthly stats**

Open `netlify/lib/stats.ts`. Add a parameter to `summarizeMonth`:

```ts
export function summarizeMonth(
  monthKey: string,
  bookingsInMonth: StatBooking[],
  pastBookingsBeforeMonth: StatBooking[],
  noShowsInMonth: StatNoShow[],
  cancellationsInMonth: { kind: string }[],   // NEW
  services: Service[]
): MonthlyStats {
  // ...existing body...
  const cancellationsByKind = {
    byAdmin: cancellationsInMonth.filter((c) => c.kind === "by-admin").length,
    byClient: cancellationsInMonth.filter((c) => c.kind === "by-client").length,
    rejected: cancellationsInMonth.filter((c) => c.kind === "rejected").length,
  };
  return {
    // ...existing fields...
    cancellationsByKind,
  };
}
```

Update the `MonthlyStats` interface to include `cancellationsByKind`. Then update `netlify/functions/admin-stats.ts` to fetch the cancellation log and pass the in-month slice.

- [ ] **Step 9: Integration test**

Create `tests/integration/admin-cancellations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import type { HandlerEvent } from "@netlify/functions";
import { InMemoryStore, resetStoreForTests } from "../../netlify/lib/blobs";
import { setupAdmin, issueToken } from "../../netlify/lib/auth";
import { appendCancellation } from "../../netlify/lib/config";
import { handler } from "../../netlify/functions/admin-cancellations";

function ev(query?: Record<string, string>, cookie?: string): HandlerEvent {
  const q = query ? new URLSearchParams(query).toString() : "";
  return {
    rawUrl: `https://example.com/api/admin/cancellations${q ? `?${q}` : ""}`,
    rawQuery: q, path: "/api/admin/cancellations", httpMethod: "GET",
    headers: cookie ? { cookie: `lessenza_admin=${cookie}` } : {},
    multiValueHeaders: {}, queryStringParameters: query ?? null,
    multiValueQueryStringParameters: null, body: null, isBase64Encoded: false,
  } as HandlerEvent;
}

describe("/api/admin/cancellations", () => {
  beforeEach(async () => {
    resetStoreForTests(new InMemoryStore());
    await setupAdmin("pw-12345678");
  });

  it("returns empty list initially", async () => {
    const tok = await issueToken();
    const r = await handler(ev({}, tok), {} as never);
    expect(JSON.parse(r!.body as string).cancellations).toEqual([]);
  });

  it("appends + filters by date range", async () => {
    const tok = await issueToken();
    await appendCancellation({
      eventId: "e1", appointmentISO: "2026-04-10T09:00:00.000Z",
      cancelledAt: "2026-04-09T12:00:00.000Z", kind: "by-admin",
    });
    await appendCancellation({
      eventId: "e2", appointmentISO: "2026-05-10T09:00:00.000Z",
      cancelledAt: "2026-05-09T12:00:00.000Z", kind: "by-client",
    });
    const r = await handler(ev({ from: "2026-05-01T00:00:00.000Z" }, tok), {} as never);
    const body = JSON.parse(r!.body as string);
    expect(body.cancellations).toHaveLength(1);
    expect(body.cancellations[0].eventId).toBe("e2");
  });
});
```

Run: `npm run test -- tests/integration/admin-cancellations.test.ts`
Expected: 2 tests pass.

- [ ] **Step 10: Commit**

```bash
git add netlify/lib/schemas.ts netlify/lib/config.ts netlify/lib/stats.ts \
        netlify/functions/admin-cancel-booking.ts netlify/functions/admin-reject-booking.ts \
        netlify/functions/public-cancel.ts netlify/functions/admin-no-show.ts \
        netlify/functions/admin-cancellations.ts netlify/functions/admin-stats.ts \
        tests/integration/admin-cancellations.test.ts
git commit -m "feat(history): cancellation log + monthly breakdown by kind"
git push
```

---

### Task 7: GDPR audit — privatnost.html rewrite

**Files:**
- Modify: `privatnost.html`

This task is pure copy. Replace the existing privatnost.html body with a structured policy that mirrors what the system actually stores.

- [ ] **Step 1: Rewrite privatnost.html**

Open `privatnost.html`. Replace everything between `<main>...</main>` (or the equivalent content section) with:

```html
<section class="page-hero">
  <div class="page-hero__inner">
    <span class="section-label">Pravna obavještenja</span>
    <h1 class="page-hero__title">Politika privatnosti</h1>
    <p class="page-hero__subtitle">Posljednje ažurirano: 28. april 2026.</p>
  </div>
</section>

<section class="section">
  <div class="section__inner" style="max-width:760px;">

    <h2>1. Ko smo</h2>
    <p>L'Essenza Beauty Salon, Bajova 22, Cetinje. Kontakt: <a href="mailto:info@lessenza.me">info@lessenza.me</a>.</p>

    <h2>2. Koje podatke prikupljamo</h2>
    <p>Pri online rezervaciji termina (na <a href="zakazivanje.html">/zakazivanje</a>):</p>
    <ul>
      <li><strong>Ime i prezime</strong> — da znamo koga čekamo.</li>
      <li><strong>Broj telefona</strong> — obavezno, za potvrdu, izmjene termina, podsjetnik.</li>
      <li><strong>Email</strong> — opcionalno, za potvrdu emailom + opciono otkazivanje preko linka.</li>
      <li><strong>Napomena</strong> — opcionalno, ako želite dodati zahtjev (npr. „alergična sam na…").</li>
      <li><strong>IP adresa</strong> — privremeno, samo za rate-limiting (sprečavanje spam rezervacija). Briše se posle 24 sata.</li>
    </ul>

    <h2>3. Gdje se podaci čuvaju</h2>
    <ul>
      <li><strong>Termini</strong> — u Google Calendar nalogu salona (Google LLC, Mountain View, USA — pod GDPR Standard Contractual Clauses).</li>
      <li><strong>Privatne napomene koje vlasnica salona pravi</strong> — na našem serveru (Hetzner, Njemačka, EU) u SQLite bazi. Klijenti ih nikad ne vide.</li>
      <li><strong>Email-ovi</strong> — šalju se preko PrivateEmail (Namecheap, USA — DPA potpisan).</li>
    </ul>

    <h2>4. Koliko dugo čuvamo</h2>
    <ul>
      <li><strong>Aktivni termini</strong> — dok god su u Google Calendar-u (vlasnica može obrisati u svako doba).</li>
      <li><strong>Istorija termina</strong> — neograničeno (Google Calendar ne briše prošle event-e).</li>
      <li><strong>Otkazani termini (cancellation log)</strong> — 5000 zadnjih, oko 5–10 godina za prosječan salon.</li>
      <li><strong>Privatne napomene</strong> — dok god vlasnica ne obriše ručno ili dok ne zatražite brisanje.</li>
      <li><strong>Blokirani brojevi</strong> — neograničeno, dok ih vlasnica ne odblokira.</li>
      <li><strong>Upiti (inquiries)</strong> — 60 dana, zatim se brišu automatski.</li>
    </ul>

    <h2>5. S kim dijelimo podatke</h2>
    <p>Sa nikim. Ne prodajemo i ne dijelimo podatke trećim licima u marketinške svrhe. Tehnički, podaci prolaze kroz:</p>
    <ul>
      <li>Google (Calendar API) — neophodno za rad sistema.</li>
      <li>PrivateEmail (Namecheap) — slanje email-ova.</li>
      <li>Hetzner Cloud — naš server (EU).</li>
    </ul>
    <p>Sve troje su pod GDPR-compatible obradama podataka (DPA potpisan za sve gdje je primjenjivo).</p>

    <h2>6. Vaša prava</h2>
    <p>U skladu sa GDPR-om i Zakonom o zaštiti podataka o ličnosti Crne Gore, imate pravo da:</p>
    <ul>
      <li><strong>Vidite</strong> sve podatke koje držimo o vama.</li>
      <li><strong>Ispravite</strong> netačne podatke.</li>
      <li><strong>Obrišete</strong> sve svoje podatke ("pravo na zaborav").</li>
      <li><strong>Prenesete</strong> svoje podatke u mašinski čitljivom formatu (data portability).</li>
      <li><strong>Povučete pristanak</strong> i prestanete primati emailove (svaki email ima link).</li>
    </ul>
    <p>Za bilo koji od ovih zahtjeva — pošaljite email na <a href="mailto:info@lessenza.me">info@lessenza.me</a> sa naslovom „GDPR zahtjev". Odgovaramo u roku od 30 dana.</p>

    <h2>7. Kolačići (cookies)</h2>
    <p>Javni sajt ne koristi tracking cookies. Admin panel koristi jedan session cookie (HttpOnly, Secure) — samo za prijavljenu vlasnicu. Bez third-party tracking pixela, bez Facebook/Google Analytics-a (osim ako vlasnica eksplicitno uključi privacy-friendly analitiku poput Plausible u Podešavanjima — u tom slučaju, info ovdje se ažurira).</p>

    <h2>8. Sigurnost</h2>
    <ul>
      <li>HTTPS svuda (Let's Encrypt).</li>
      <li>Lozinka admin panela: bcrypt hash (nikad u plain text-u).</li>
      <li>Otkazivanje termina: HMAC-potpisani token, niko ne može pogađati linkove.</li>
      <li>Dnevni backup na Hetzner Storage Box (EU).</li>
    </ul>

    <h2>9. Promjene politike</h2>
    <p>Datum „Posljednje ažurirano" na vrhu stranice se mijenja kad nešto izmijenimo. Materijalne promjene najavićemo u email-u stalnih klijentkinja.</p>

    <h2>10. Pitanja</h2>
    <p>Za sve što vas interesuje: <a href="mailto:info@lessenza.me">info@lessenza.me</a>.</p>

  </div>
</section>
```

- [ ] **Step 2: Commit**

```bash
git add privatnost.html
git commit -m "docs: GDPR-compliant privacy policy reflecting actual data + retention"
git push
```

---

### Task 8: Full data export (GDPR portability)

**Files:**
- Create: `netlify/functions/admin-export-data.ts`
- Modify: `admin/tabs/settings.js` — add "Preuzmi sve podatke" button

- [ ] **Step 1: Endpoint**

Create `netlify/functions/admin-export-data.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import {
  getServices, getWorkingHours, getSettings, getParallelPairs, getBlocks,
  listInquiries, getBlockedPhones, getDayNote, getCancellationLog,
  listAllNoShows, getDismissedSuggestions,
} from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);

  const [services, hours, settings, pairs, blocks, inquiries, blockedPhones, cancellations, noShows, dismissed] = await Promise.all([
    getServices(), getWorkingHours(), getSettings(), getParallelPairs(),
    getBlocks(), listInquiries(), getBlockedPhones(), getCancellationLog(),
    listAllNoShows(), getDismissedSuggestions(),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    salon: settings.salonAddress + ", " + settings.salonCity,
    services,
    workingHours: hours,
    settings,
    parallelPairs: pairs,
    blocks,
    inquiries,
    blockedPhones,
    cancellations,
    noShows,
    dismissedSuggestions: dismissed,
    note: "Termini se vode u Google Calendar-u i tu su autoritativni — eksport bookings-a iz kalendara: https://calendar.google.com/calendar/u/0/r/settings/export",
  };

  // Stream-friendly response with attachment header.
  const filename = `lessenza-data-${new Date().toISOString().slice(0, 10)}.json`;
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
    body: JSON.stringify(dump, null, 2),
  };
};

export const handler = adminGuard(inner);
```

- [ ] **Step 2: Settings UI button**

In `admin/tabs/settings.js`, after the existing blocked-phones section, append:

```js
const exportBtn = document.createElement("button");
exportBtn.type = "button";
exportBtn.className = "btn btn-ghost block";
exportBtn.style.marginTop = "1rem";
exportBtn.textContent = "📥 Preuzmi sve podatke (JSON)";
exportBtn.addEventListener("click", () => {
  // Direct navigation triggers the attachment download via the cookie session.
  window.location.href = "/api/admin/export-data";
});
document.querySelector("#bp-list").parentNode.appendChild(exportBtn);
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/admin-export-data.ts admin/tabs/settings.js
git commit -m "feat(gdpr): one-click data export — full owner-portable JSON dump"
git push
```

---

## Phase 4 — Reliability

### Task 9: Sentry error monitoring

**Files:**
- Modify: `package.json` — add `@sentry/node`
- Modify: `server/index.ts` — wrap entry
- Modify: `.env.example` — document `SENTRY_DSN`
- Modify: `docs/HETZNER-DEPLOY.md` — setup section

- [ ] **Step 1: Install dependency**

```bash
npm install @sentry/node
```

- [ ] **Step 2: Wrap server entry**

Open `server/index.ts`. At the very top, before any other imports:

```ts
import * as Sentry from "@sentry/node";
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0.1, // 10% of requests
  });
}
```

After all routes are mounted but before `app.listen(...)`:

```ts
if (process.env.SENTRY_DSN) {
  app.use((err: unknown, _req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    Sentry.captureException(err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "internal", message: "Greška na serveru" });
  });
}
```

- [ ] **Step 3: Document in .env.example**

Append:

```
# --- Error monitoring (optional) ---
# Free Sentry tier: 5k errors/month. Sign up at sentry.io, create
# Node project, copy the DSN. Leave empty to disable.
SENTRY_DSN=
```

- [ ] **Step 4: Document in deploy guide**

In `docs/HETZNER-DEPLOY.md` add a section under "5. Env file":

```markdown
### Optional: Sentry error monitoring

If you want emails when something crashes in production:

1. Sign up at https://sentry.io (free tier: 5k errors/month).
2. Create a project → "Node.js" → copy the DSN.
3. Add to `/opt/lessenza/app/.env`:
   ```
   SENTRY_DSN=https://abc123@o123456.ingest.sentry.io/789
   ```
4. `systemctl restart lessenza`.

In Sentry → Alerts → set up a rule: "When new issue → email me".
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json server/index.ts .env.example docs/HETZNER-DEPLOY.md
git commit -m "feat(ops): optional Sentry error monitoring"
git push
```

---

### Task 10: Cancel token expiry

**Files:**
- Modify: `netlify/lib/cancel-token.ts` — embed expiry, verify checks it
- Modify: `netlify/functions/book.ts` — pass expiresAt = endISO + 24h
- Modify: `tests/unit/cancel-token.test.ts` — add expiry tests

- [ ] **Step 1: Refactor token to include expiresAt**

Replace `netlify/lib/cancel-token.ts` with:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function b64url(buf: Buffer | Uint8Array | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : Buffer.from(buf);
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function getSecret(): string {
  const s = process.env.JWT_SECRET || process.env.SETUP_TOKEN || "";
  if (!s) throw new Error("JWT_SECRET not configured — cannot sign cancel tokens");
  return s;
}

export interface MakeOpts {
  /** Token stops working at this ISO timestamp. */
  expiresAtISO: string;
}

export function makeCancelToken(eventId: string, opts: MakeOpts): string {
  if (!eventId) throw new Error("eventId required");
  if (!opts.expiresAtISO) throw new Error("expiresAtISO required");
  const payload = `${eventId}|${opts.expiresAtISO}`;
  const sig = createHmac("sha256", getSecret()).update(payload).digest();
  return `${b64url(payload)}.${b64url(sig)}`;
}

export type VerifyResult = { ok: true; eventId: string; expiresAtISO: string } | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifyCancelToken(token: string, now = new Date()): VerifyResult {
  if (!token || typeof token !== "string") return { ok: false, reason: "malformed" };
  const idx = token.indexOf(".");
  if (idx <= 0 || idx === token.length - 1) return { ok: false, reason: "malformed" };
  const payloadB64 = token.slice(0, idx);
  const sigB64 = token.slice(idx + 1);
  let payload: string;
  let sig: Buffer;
  try {
    payload = b64urlDecode(payloadB64).toString("utf8");
    sig = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const sep = payload.lastIndexOf("|");
  if (sep <= 0) return { ok: false, reason: "malformed" };
  const eventId = payload.slice(0, sep);
  const expiresAtISO = payload.slice(sep + 1);
  if (!eventId || !expiresAtISO) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", getSecret()).update(payload).digest();
  if (sig.length !== expected.length) return { ok: false, reason: "bad-signature" };
  let safe = false;
  try { safe = timingSafeEqual(sig, expected); } catch { safe = false; }
  if (!safe) return { ok: false, reason: "bad-signature" };
  if (now.getTime() > new Date(expiresAtISO).getTime()) return { ok: false, reason: "expired" };
  return { ok: true, eventId, expiresAtISO };
}
```

- [ ] **Step 2: Update book.ts**

In `netlify/functions/book.ts`, find where `makeCancelToken(booking.calendarEventId)` is called and replace with:

```ts
const eventEndMs = new Date(booking.endISO).getTime();
const expiresAtISO = new Date(eventEndMs + 24 * 60 * 60 * 1000).toISOString();
const t = makeCancelToken(booking.calendarEventId, { expiresAtISO });
```

- [ ] **Step 3: Update tests**

Replace `tests/unit/cancel-token.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { makeCancelToken, verifyCancelToken } from "../../netlify/lib/cancel-token";

describe("cancel-token", () => {
  beforeEach(() => { process.env.JWT_SECRET = "test-secret-do-not-use-in-prod"; });

  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 1000).toISOString();

  it("round-trips a token", () => {
    const t = makeCancelToken("evt_abc", { expiresAtISO: future });
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.eventId).toBe("evt_abc");
      expect(r.expiresAtISO).toBe(future);
    }
  });

  it("rejects an expired token", () => {
    const t = makeCancelToken("evt_abc", { expiresAtISO: past });
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("expired");
  });

  it("rejects a tampered token", () => {
    const t = makeCancelToken("evt_abc", { expiresAtISO: future });
    const tampered = t.slice(0, -3) + "AAA";
    expect(verifyCancelToken(tampered).ok).toBe(false);
  });

  it("rejects malformed input", () => {
    expect(verifyCancelToken("").ok).toBe(false);
    expect(verifyCancelToken("only-one-part").ok).toBe(false);
    expect(verifyCancelToken("a.b").ok).toBe(false);
  });

  it("token with eventId containing | survives", () => {
    const t = makeCancelToken("evt|with|pipes", { expiresAtISO: future });
    const r = verifyCancelToken(t);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eventId).toBe("evt|with|pipes");
  });
});
```

Run: `npm run test -- tests/unit/cancel-token.test.ts`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add netlify/lib/cancel-token.ts netlify/functions/book.ts tests/unit/cancel-token.test.ts
git commit -m "feat(security): cancel tokens expire 24h after appointment ends"
git push
```

---

## Phase 5 — UX & limits

### Task 11: Image upload limit + auto-resize

**Files:**
- Modify: `package.json` — add `sharp`
- Modify: `deploy/nginx-lessenza.conf` — `client_max_body_size 12m`
- Modify: `server/index.ts` (or the upload endpoint) — pipe through sharp
- Test: existing upload tests still pass + new size-limit test

- [ ] **Step 1: Install sharp**

```bash
npm install sharp
```

- [ ] **Step 2: Find the existing upload handler**

```bash
grep -rn "multer\|formidable\|Busboy\|upload" /Users/vanja/Projects/lessenza/netlify/functions/ /Users/vanja/Projects/lessenza/server/ | head -10
```

(The upload handler depends on what existing code uses. Open the file that handles `/api/admin/gallery-upload` or similar.)

- [ ] **Step 3: Pipe through sharp**

In whichever upload endpoint exists (likely `netlify/functions/admin-gallery-upload.ts`), wrap the saved file path through:

```ts
import sharp from "sharp";

// After receiving the upload buffer:
const out = await sharp(uploadBuffer, { failOn: "error" })
  .rotate() // honor EXIF orientation
  .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
  .jpeg({ quality: 82, progressive: true })
  .toBuffer();
// `out` replaces the raw upload before being written to /opt/lessenza/app/uploads/.
```

Reject anything > 12 MB or non-image MIME with 413 / 415:

```ts
if (uploadBuffer.length > 12 * 1024 * 1024) {
  return badRequest("too-large", "Image must be under 12 MB");
}
if (!/^image\//.test(mimeType)) {
  return badRequest("bad-type", "Only images allowed");
}
```

- [ ] **Step 4: nginx limit**

In `deploy/nginx-lessenza.conf`, find the `server { listen 80; ... }` block and replace `client_max_body_size 2m;` with:

```nginx
client_max_body_size 12m;
```

(If no current limit, add it inside the server block.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json deploy/nginx-lessenza.conf netlify/functions/admin-gallery-upload.ts
git commit -m "feat(uploads): 12MB limit + sharp auto-resize to 1920px JPEG-82"
git push
```

(Owner reloads nginx after deploy: `sudo nginx -t && sudo systemctl reload nginx`.)

---

### Task 12: PWA push notifications (new booking → owner ping)

**Files:**
- Modify: `package.json` — add `web-push`
- Modify: `netlify/lib/schemas.ts` — `PushSubscriptionSchema`
- Modify: `netlify/lib/config.ts` — accessors
- Create: `netlify/functions/admin-push-subscribe.ts`
- Create: `netlify/functions/admin-push-unsubscribe.ts`
- Modify: `netlify/functions/book.ts` — fire push to owner on new booking
- Modify: `js/sw.js` (or admin/sw.js) — push event handler
- Modify: `admin/tabs/settings.js` — UI: "Uključi notifikacije" button
- Modify: `.env.example` — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Modify: `docs/HETZNER-DEPLOY.md` — VAPID key generation step

- [ ] **Step 1: Generate VAPID keys**

Document this owner-side step (one-time). In `docs/HETZNER-DEPLOY.md` append:

```markdown
## 18. VAPID keys for push notifications

```bash
npx web-push generate-vapid-keys
```

Add to `/opt/lessenza/app/.env`:
```
VAPID_PUBLIC_KEY=<BBxxx...>
VAPID_PRIVATE_KEY=<xxx...>
VAPID_SUBJECT=mailto:info@lessenza.me
```

`systemctl restart lessenza`.
```

- [ ] **Step 2: Install web-push**

```bash
npm install web-push
```

- [ ] **Step 3: Schema + accessors**

In `netlify/lib/schemas.ts`:

```ts
export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  createdAt: z.string().datetime(),
});
export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
export const PushSubscriptionsSchema = z.array(PushSubscriptionSchema);
```

In `netlify/lib/config.ts`:

```ts
const KEY_PUSH_SUBS = "auth/push-subscriptions.json";

export async function getPushSubscriptions(): Promise<PushSubscription[]> {
  const raw = await store().getJSON<unknown>(KEY_PUSH_SUBS);
  if (!raw) return [];
  const r = PushSubscriptionsSchema.safeParse(raw);
  return r.success ? r.data : [];
}

export async function addPushSubscription(sub: PushSubscription): Promise<void> {
  const cur = await getPushSubscriptions();
  if (cur.find((s) => s.endpoint === sub.endpoint)) return; // dedupe
  const next = PushSubscriptionsSchema.parse([sub, ...cur]);
  await store().setJSON(KEY_PUSH_SUBS, next);
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const cur = await getPushSubscriptions();
  const next = cur.filter((s) => s.endpoint !== endpoint);
  await store().setJSON(KEY_PUSH_SUBS, PushSubscriptionsSchema.parse(next));
}
```

- [ ] **Step 4: Subscribe / unsubscribe endpoints**

`netlify/functions/admin-push-subscribe.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, badRequest, methodNotAllowed, parseJson } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";
import { addPushSubscription } from "../lib/config";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowed(["POST"]);
  let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try { body = parseJson(event.body); } catch { return badRequest("invalid-json", "Body must be JSON"); }
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) return badRequest("missing-fields", "endpoint+keys required");
  await addPushSubscription({ endpoint, keys: { p256dh, auth }, createdAt: new Date().toISOString() });
  return json({ ok: true });
};

export const handler = adminGuard(inner);
```

Mirror for `unsubscribe`.

- [ ] **Step 5: Fire push on new booking**

In `netlify/functions/book.ts`, after the email sends, append:

```ts
import webpush from "web-push";
import { getPushSubscriptions, removePushSubscription } from "../lib/config";

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:info@lessenza.me",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  const subs = await getPushSubscriptions();
  const payload = JSON.stringify({
    title: "Novi termin",
    body: `${booking.serviceName} — ${booking.name}, ${formatSalon(new Date(booking.startISO), "dd.MM. 'u' HH:mm")}`,
    url: "/admin/",
  });
  for (const s of subs) {
    try {
      await webpush.sendNotification(s, payload);
    } catch (e: unknown) {
      // Stale subscription — drop it.
      const err = e as { statusCode?: number };
      if (err.statusCode === 404 || err.statusCode === 410) await removePushSubscription(s.endpoint);
    }
  }
}
```

- [ ] **Step 6: Service worker push handler**

In the existing service worker (e.g. `sw.js`), append:

```js
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || "L'Essenza", {
    body: data.body || "",
    icon: "/img/icon-192.png",
    badge: "/img/icon-192.png",
    data: { url: data.url || "/admin/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/admin/";
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if (c.url.includes(url)) return c.focus();
    return self.clients.openWindow(url);
  }));
});
```

- [ ] **Step 7: Settings UI button**

Append to `admin/tabs/settings.js`:

```js
async function renderPushCard() {
  const host = document.getElementById("push-host");
  if (!host) return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    host.innerHTML = `<div class="muted">Push notifikacije nisu podržane na ovom uređaju.</div>`;
    return;
  }
  const sw = await navigator.serviceWorker.ready;
  const sub = await sw.pushManager.getSubscription();
  host.innerHTML = sub
    ? `<button class="btn btn-ghost block" id="push-off">🔕 Isključi push notifikacije</button>`
    : `<button class="btn btn-primary block" id="push-on">🔔 Uključi push notifikacije</button>`;
  const on = document.getElementById("push-on");
  if (on) on.addEventListener("click", async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Dozvola odbijena.", "error");
    const { vapidPublicKey } = await must("/api/admin/push-public-key"); // see step 8
    const newSub = await sw.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
    await must("/api/admin/push-subscribe", { method: "POST", body: newSub.toJSON() });
    toast("Push notifikacije uključene.", "success");
    await renderPushCard();
  });
  const off = document.getElementById("push-off");
  if (off) off.addEventListener("click", async () => {
    await sub.unsubscribe();
    await must("/api/admin/push-unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } });
    toast("Isključeno.", "success");
    await renderPushCard();
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
```

In the existing `render()` add `await renderPushCard();`. In `admin/index.html` add `<div id="push-host"></div>` near the TOTP host.

- [ ] **Step 8: Public-key endpoint**

Create `netlify/functions/admin-push-public-key.ts`:

```ts
import type { Handler } from "@netlify/functions";
import { json, methodNotAllowed } from "../lib/http";
import { adminGuard } from "../lib/admin-guard";

const inner: Handler = async (event) => {
  if (event.httpMethod !== "GET") return methodNotAllowed(["GET"]);
  return json({ vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? "" });
};

export const handler = adminGuard(inner);
```

- [ ] **Step 9: Document `.env.example`**

Append:

```
# --- Push notifications (PWA) ---
# Generate once: npx web-push generate-vapid-keys
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:info@lessenza.me
```

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json \
        netlify/lib/schemas.ts netlify/lib/config.ts \
        netlify/functions/admin-push-subscribe.ts netlify/functions/admin-push-unsubscribe.ts \
        netlify/functions/admin-push-public-key.ts netlify/functions/book.ts \
        sw.js admin/tabs/settings.js admin/index.html \
        .env.example docs/HETZNER-DEPLOY.md
git commit -m "feat(pwa): web-push notifications for owner on new booking"
git push
```

---

## Final Step: Verification across all phases

- [ ] **Step 1: Full test suite must be green**

```bash
npm run test
```
Expected: all tests pass (the long-running `bufferMinutes` failure was fixed in Phase 1).

- [ ] **Step 2: TypeScript type check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Manual smoke test on iPhone 390×844**

- Public booking flow: book → email arrives with cancel link → cancel via link works.
- Public booking flow with email — confirm SPF/DKIM/DMARC pass via mail-tester.
- Admin: forgot password → email arrives → reset link works → log in with new password.
- Admin: enable 2FA → log out → log in: password + TOTP code → success.
- Admin: cancel a test booking → check `/api/admin/cancellations` shows it.
- Admin: download data export → JSON contains expected sections.
- Admin: enable push → book a test → notification arrives.
- Admin: upload a 15MB image → rejected with size error. Upload 5MB image → resized to ≤1920px JPEG.

If any smoke test fails, fix in a follow-up commit.

- [ ] **Step 4: Final commit + tag**

```bash
git tag v1.0-product-readiness
git push --tags
```
