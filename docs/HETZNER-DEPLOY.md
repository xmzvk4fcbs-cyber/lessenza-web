# L'Essenza — Hetzner VPS deploy runbook

A step-by-step guide for moving `lessenza.me` from Netlify onto a fresh Hetzner
Cloud VPS (Ubuntu 24.04). Written to be followed top-to-bottom by the salon owner;
every command is copy-pasteable.

Email stays at **PrivateEmail** (Namecheap): `info@lessenza.me` via
`mail.privateemail.com:465`. Domain stays `lessenza.me`.

---

## Prerequisites / Gaps to fix first

Read this section before doing anything on the server.

### Owner needs to have ready

- A fresh Hetzner Cloud VPS (Ubuntu 24.04), with your SSH public key uploaded
  in the Hetzner Console so `ssh root@<ip>` works.
- The **public IPv4 address** of the VPS (Hetzner Console → Servers → your
  server → Overview).
- Access to the DNS management page at your domain registrar for `lessenza.me`.
- The **PrivateEmail mailbox password** for `info@lessenza.me` (from
  Namecheap → Private Email dashboard). Keep it private — you will paste it
  into a file on the server only, never commit or share it.
- Your **Netlify Site ID** and a **Netlify personal access token**, *only if*
  you want to preserve existing bookings/settings from the Netlify deployment
  (Step 6). Skip if a clean slate is acceptable.
- An email address for Let's Encrypt expiry notices (usually
  `info@lessenza.me`).

### Code-level gaps noticed during audit (not blockers, but worth knowing)

These are observations from auditing `server/`, `deploy/`, and the Netlify
functions. None of them stop a successful deploy today; they're listed so you
know what the runbook is papering over.

1. **Cron endpoints are exposed unauthenticated on the public API.** The
   auto-mount in `server/index.ts` exposes `/api/cron-reminder` and
   `/api/cron-daily-digest` because they're regular Netlify function files.
   The in-process scheduler (node-cron) fires them directly, so the public
   route isn't *needed*, but anyone who knows the path can trigger them.
   Both handlers are idempotent (reminders are deduped via
   `reminders-sent/*.json`; digest just emails owner). Not a security issue,
   just mild noise potential. Leave as-is for now.
2. **Systemd unit runs TypeScript via `tsx`, not compiled JS.** The checked-in
   `deploy/lessenza.service` uses
   `node --no-warnings --import tsx/esm server/index.ts`. That matches
   `npm start` and works in production because `tsx` is a runtime dep (not
   dev-only). `package.json`'s `build` is `tsc --noEmit` (type-check only) —
   there is no `dist/` built for production. This runbook uses the existing
   tsx-based unit file. Do not try to add `npm run build` — it won't emit
   anything.
3. **`SITE_URL` is required** (env-check.ts hard-fails without it). The setup
   script writes it as `https://lessenza.me`; just don't delete that line.
4. **Migration script key coverage.** `deploy/migrate-from-blobs.ts` copies
   *every* key the Netlify Blobs list endpoint returns via `list({ prefix: "" })`,
   so newer keys like `blocked-phones/*.json` and `google/oauth-app.json` are
   picked up automatically. No code change needed.
5. **`.gitignore`** already covers `.env`, `.env.*` (with `!.env.example`
   whitelist), `node_modules/`, `dist/`, `.netlify/`. Nothing to fix.
6. **Google OAuth redirect URI is hardcoded-ish.** `getRedirectUri()` uses
   `SITE_URL` env, so as long as `.env` has `SITE_URL=https://lessenza.me`,
   it points at the server correctly. The Google Cloud Console OAuth client
   must list `https://lessenza.me/api/admin/google-callback` as an Authorized
   Redirect URI. If it already worked on Netlify, no change needed.
7. **A bundled `setup.sh` exists** (`deploy/setup.sh`) that does most of
   Steps 2–5 of this runbook in one shot. We use explicit commands below so
   you can see what each step does; you can swap in `setup.sh` once
   comfortable.

If any of the above need **code fixes**, flag them before running the runbook.
Nothing above blocks a deploy today.

---

## 1. DNS — point the domain at Hetzner

Do this **first** so propagation happens while you do the server work (5–30
minutes typical).

At your domain registrar's DNS page for `lessenza.me`:

| Type  | Name  | Value                    | TTL  |
| ----- | ----- | ------------------------ | ---- |
| A     | `@`   | *your Hetzner IPv4*      | 300  |
| A     | `www` | *your Hetzner IPv4*      | 300  |

If your VPS also has an IPv6 address (Hetzner usually does), add two more:

| Type  | Name  | Value                    | TTL  |
| ----- | ----- | ------------------------ | ---- |
| AAAA  | `@`   | *your Hetzner IPv6*      | 300  |
| AAAA  | `www` | *your Hetzner IPv6*      | 300  |

Remove any old A/AAAA records pointing at Netlify.

Verify from your laptop (after ~5 min):

```bash
dig +short lessenza.me
dig +short www.lessenza.me
```

Both should return your Hetzner IP.

---

## 2. SSH + initial hardening

From your laptop, log in as root:

```bash
ssh root@<your-hetzner-ip>
```

Update the system and create a non-root user for day-to-day ops:

```bash
apt-get update && apt-get upgrade -y
adduser --disabled-password --gecos "" salon
usermod -aG sudo salon
# Copy root's authorized_keys so you can ssh salon@<ip> right away:
mkdir -p /home/salon/.ssh
cp /root/.ssh/authorized_keys /home/salon/.ssh/authorized_keys
chown -R salon:salon /home/salon/.ssh
chmod 700 /home/salon/.ssh
chmod 600 /home/salon/.ssh/authorized_keys
```

Enable the firewall (SSH 22, HTTP 80, HTTPS 443 only):

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

From now on, you can `ssh salon@<ip>` and use `sudo` for admin commands.
(Keep the root session open until you verify the salon user works.)

---

## 3. Install runtime

Still as root:

```bash
# Node.js 22 LTS (nodesource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Supporting packages
apt-get install -y git nginx certbot python3-certbot-nginx sqlite3 build-essential

# Sanity check
node --version    # should be v22.x
npm --version
nginx -v
certbot --version
sqlite3 --version
```

---

## 4. Clone + install the app

Create a dedicated service user (non-login) for the app itself — separate from
the `salon` admin user:

```bash
useradd --system --shell /usr/sbin/nologin --home-dir /opt/lessenza/app lessenza
mkdir -p /opt/lessenza/app /opt/lessenza/app/data
chown -R lessenza:lessenza /opt/lessenza
chmod 700 /opt/lessenza/app/data
```

Clone the repo as the `lessenza` user:

```bash
# Replace with the real repo URL. If private, use a deploy key or HTTPS + token.
sudo -u lessenza git clone https://github.com/xmzvk4fcbs-cyber/lessenza-web.git /opt/lessenza/app
```

Install production dependencies:

```bash
cd /opt/lessenza/app
sudo -u lessenza npm ci --omit=dev --no-audit --no-fund
```

No build step needed — the server runs TypeScript directly via `tsx`, which is
bundled in `dependencies`. `npm run build` is only a type-check and emits
nothing.

---

## 5. Create the `.env` file

Generate two secrets first:

```bash
# Run these on the server, copy the two hex strings into the file below.
openssl rand -hex 32    # → this becomes JWT_SECRET
openssl rand -hex 16    # → this becomes SETUP_TOKEN (temporary, removed in Step 10)
```

Create `/opt/lessenza/app/.env`:

```bash
sudo -u lessenza tee /opt/lessenza/app/.env > /dev/null <<'EOF'
# === L'Essenza production env ===

# --- Core ---
SELF_HOSTED=1
NODE_ENV=production
SITE_URL=https://lessenza.me
HOST=127.0.0.1
PORT=3000
LESSENZA_DB_PATH=/opt/lessenza/app/data/lessenza.db

# --- Secrets (fill in from the two openssl commands above) ---
JWT_SECRET=PASTE_THE_64_CHAR_HEX_FROM_openssl_rand_hex_32
SETUP_TOKEN=PASTE_THE_32_CHAR_HEX_FROM_openssl_rand_hex_16

# --- Email (PrivateEmail / Namecheap SMTP) ---
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@lessenza.me
SMTP_PASS=PASTE_THE_MAILBOX_PASSWORD_HERE
SMTP_FROM=L'Essenza <info@lessenza.me>
EOF

chmod 600 /opt/lessenza/app/.env
chown lessenza:lessenza /opt/lessenza/app/.env
```

Now edit the three placeholders:

```bash
sudo -u lessenza nano /opt/lessenza/app/.env
```

Replace:
- `PASTE_THE_64_CHAR_HEX_FROM_openssl_rand_hex_32` — the first hex string.
- `PASTE_THE_32_CHAR_HEX_FROM_openssl_rand_hex_16` — the second hex string.
  You will **delete** this line in Step 10 after first-time admin setup.
- `PASTE_THE_MAILBOX_PASSWORD_HERE` — the PrivateEmail mailbox password for
  `info@lessenza.me`.

Save with `Ctrl-O`, `Enter`, `Ctrl-X`.

Quick sanity-check the file is 600 and owned by `lessenza`:

```bash
ls -la /opt/lessenza/app/.env
# expected: -rw------- 1 lessenza lessenza  ...  .env
```

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

---

## 6. Data migration (OPTIONAL — skip for a clean start)

### 6A. Clean start (recommended if you don't need old Netlify data)

Nothing to do. The SQLite DB will be created automatically on first boot
inside `/opt/lessenza/app/data/lessenza.db`. You will seed the admin password
on the setup screen in Step 10.

### 6B. Migrate bookings/settings from Netlify Blobs

Do this **on your Mac** (not the server) — it needs `npx`, the repo, and
internet access to Netlify:

```bash
# 6B-1. Get credentials from the Netlify dashboard:
#   Netlify → User settings → Applications → Personal access tokens → New
#     (name it "migration", scope full, copy token once)
#   Netlify → Site settings → General → Site information → Site ID
cd ~/Projects/lessenza

# 6B-2. Dry run (read-only, prints categories and counts):
NETLIFY_SITE_ID=<your-site-id> \
NETLIFY_BLOBS_TOKEN=<your-personal-access-token> \
LESSENZA_DB_PATH=./migration.db \
npx tsx deploy/migrate-from-blobs.ts --dry-run

# 6B-3. Real migration (creates ./migration.db):
NETLIFY_SITE_ID=<your-site-id> \
NETLIFY_BLOBS_TOKEN=<your-personal-access-token> \
LESSENZA_DB_PATH=./migration.db \
npx tsx deploy/migrate-from-blobs.ts

# 6B-4. Upload to the server:
scp migration.db  salon@<hetzner-ip>:/tmp/lessenza.db
```

Then on the server:

```bash
sudo mv /tmp/lessenza.db /opt/lessenza/app/data/lessenza.db
sudo chown lessenza:lessenza /opt/lessenza/app/data/lessenza.db
sudo chmod 600 /opt/lessenza/app/data/lessenza.db
```

If you migrated, **skip the `/admin/setup` step** in Step 10 — your old admin
password already lives in the copied DB. Use your existing password to log in.

---

## 7. systemd service

Install the unit file (a ready-made one exists in the repo, but below is the
full contents for clarity; use whichever you prefer):

```bash
sudo tee /etc/systemd/system/lessenza.service > /dev/null <<'EOF'
[Unit]
Description=L'Essenza Beauty Salon (Node + Express + SQLite)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=lessenza
Group=lessenza
WorkingDirectory=/opt/lessenza/app
EnvironmentFile=/opt/lessenza/app/.env
ExecStart=/usr/bin/env node --no-warnings --import tsx/esm server/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/opt/lessenza/app/data
LockPersonality=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes

# Resource guardrails
LimitNOFILE=4096
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lessenza
sudo systemctl status lessenza
```

Confirm it's alive by tailing logs for a few seconds:

```bash
sudo journalctl -u lessenza -n 50 --no-pager
```

You should see lines like:

```
[storage] sqlite → /opt/lessenza/app/data/lessenza.db
[mount] 34 functions wired:
[cron] scheduled: reminder=hourly, daily-digest=18:00 UTC
[boot] L'Essenza server listening on http://127.0.0.1:3000
```

Local check (before HTTPS):

```bash
curl -s http://127.0.0.1:3000/api/health
# expected: {"ok":true,"now":"2026-..."}
```

---

## 8. nginx reverse proxy

Write the vhost:

```bash
sudo tee /etc/nginx/sites-available/lessenza > /dev/null <<'EOF'
# HTTP — redirects to HTTPS. Certbot will add more here automatically.
server {
    listen 80;
    listen [::]:80;
    server_name lessenza.me www.lessenza.me;

    # ACME challenge directory (needed for certbot renewal).
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }

    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name lessenza.me www.lessenza.me;

    # Certbot will fill these in during Step 9:
    # ssl_certificate     /etc/letsencrypt/live/lessenza.me/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/lessenza.me/privkey.pem;

    # Hardening
    server_tokens off;
    # 20m to accommodate base64-inflated 12 MB binary uploads (~16 MB JSON + headroom)
    client_max_body_size 20m;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # gzip (Node already compresses; this is a safety net)
    gzip on;
    gzip_proxied any;
    gzip_types text/plain text/css application/json application/javascript
               image/svg+xml application/xml application/xml+rss
               application/manifest+json text/xml;
    gzip_min_length 1024;

    set $upstream http://127.0.0.1:3000;

    # API routes
    location /api/ {
        proxy_pass $upstream;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    # Everything else (static + admin SPA + 404) is served by Node.
    location / {
        proxy_pass $upstream;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    access_log /var/log/nginx/lessenza.access.log;
    error_log  /var/log/nginx/lessenza.error.log warn;
}
EOF
```

Enable the site and disable the default welcome page:

```bash
sudo mkdir -p /var/www/certbot
sudo ln -sf /etc/nginx/sites-available/lessenza /etc/nginx/sites-enabled/lessenza
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Note: the `443` block will throw an error until Step 9 fills in the
`ssl_certificate` paths. Certbot does that automatically. If `nginx -t`
complains about the 443 block before you run certbot, you can temporarily
comment out the `listen 443 ssl http2;` block — certbot will uncomment it.
In practice `certbot --nginx` handles this inline; just keep going.

---

## 9. HTTPS with Let's Encrypt

Wait until DNS has propagated (Step 1). Verify from the server that
`lessenza.me` resolves to *this* box:

```bash
dig +short lessenza.me @1.1.1.1
```

Then issue certs (replace the email with your real one):

```bash
sudo certbot --nginx \
  --non-interactive --agree-tos \
  --email info@lessenza.me \
  --redirect \
  -d lessenza.me -d www.lessenza.me
```

Certbot:
- Obtains certs for both hostnames
- Rewrites `/etc/nginx/sites-enabled/lessenza` to reference the cert files
- Installs the 443 redirect if missing
- Reloads nginx
- Adds a systemd timer (`certbot.timer`) for auto-renewal

Verify auto-renewal is installed:

```bash
sudo systemctl status certbot.timer
sudo certbot renew --dry-run
```

Now hit the site from your laptop:

```bash
curl -I https://lessenza.me
curl -s https://lessenza.me/api/health
```

Both should return 200 / `{"ok":true,...}`.

---

## 10. First-run admin setup

Only do Section 10A **if you did a clean start (Step 6A)**. If you migrated
data (6B), your admin password is already in the DB — skip to Section 10B.

### 10A. Clean-start setup flow

In your browser, open:

```
https://lessenza.me/admin/setup
```

- Enter the `SETUP_TOKEN` value from the `.env` file.
- Choose a strong admin password (minimum 8 characters).
- Submit.

You should be redirected to the logged-in admin dashboard.

### 10B. Remove the setup token

After you confirm the admin login works, the `SETUP_TOKEN` line in `.env` must
be removed so nobody can re-run setup:

```bash
sudo -u lessenza nano /opt/lessenza/app/.env
# Delete the entire line starting with: SETUP_TOKEN=
# Save and exit.

sudo systemctl restart lessenza
sudo journalctl -u lessenza -n 20 --no-pager
```

Confirm `/admin/setup` now returns "Setup disabled" or 401.

---

## 11. Google Calendar connection

The salon UI connects to Google Calendar via OAuth — the owner clicks through
a consent screen. No service account, no JSON keys.

1. Open `https://lessenza.me/admin/` and log in with the admin password.
2. Go to the **"Google Kalendar i Email"** tab.
3. If this is a brand-new Google Cloud project, paste your OAuth Client ID +
   Secret first. If you carried tokens over in Step 6B, they're already stored
   and the tab shows "povezan" (connected).
4. Click **"Poveži Google nalog"** and complete the Google consent. Make sure
   to **keep the "Gmail: Send email" scope** on the consent screen — even
   though we're using PrivateEmail SMTP as the primary mailer, Google OAuth
   with `gmail.send` is a fallback. Harmless if you skip it.
5. In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0
   Client, make sure the Authorized Redirect URI **exactly** matches:

   ```
   https://lessenza.me/api/admin/google-callback
   ```

6. Back in the admin, you should see your Google account email and a green
   "povezan" badge.

Quick sync check: create a tiny test block on the **Blokade** tab, confirm it
shows up in Google Calendar. Then delete it.

Since we're using PrivateEmail SMTP, **nothing else** needs to happen for
email. The mailer picks SMTP automatically when `SMTP_HOST` is set in `.env`
(highest priority after Google OAuth).

---

## 12. Email smoke test

The cleanest end-to-end check of SMTP:

1. Open `https://lessenza.me/admin/`, log in.
2. **Today → "Ručno zakaži"** (manual booking).
3. Enter your own email address, phone, pick any service and slot.
4. Submit.
5. Within a few seconds you should receive a confirmation email from
   `info@lessenza.me` with the booking details.
6. Check "Poslato" folder in the PrivateEmail webmail — the sent message
   should show up there (since the send traveled through PrivateEmail's SMTP
   server).

If no email arrives within 30 seconds, check the logs:

```bash
sudo journalctl -u lessenza --since "5 min ago" | grep -iE "smtp|mail|error"
```

Common causes: typo in `SMTP_PASS`, or outbound port 465 blocked (Hetzner
allows it by default — confirm with `ufw status` that outgoing is ALLOW).

---

## 13. Cron jobs (already handled in-process)

The Node server uses `node-cron` inside `server/index.ts` to run:

- **Hourly reminder** (`0 * * * *` UTC) — sends the 24h-ahead email reminder.
- **Daily digest** (`0 18 * * *` UTC) — emails the owner a summary. 18:00 UTC
  equals 20:00 Podgorica time during CEST (Mar–Oct) and 19:00 during CET.

You do **not** need to install systemd timers or a separate cron. You can see
cron fires in the logs:

```bash
sudo journalctl -u lessenza | grep "\[cron\]"
```

You should see a line each time a cron fires:

```
[cron] cron-reminder firing (hourly)
```

---

## 14. Viewing logs

App logs (systemd journal):

```bash
sudo journalctl -u lessenza -f              # live tail
sudo journalctl -u lessenza --since "1h ago"
sudo journalctl -u lessenza --since today
```

nginx logs:

```bash
sudo tail -f /var/log/nginx/lessenza.access.log
sudo tail -f /var/log/nginx/lessenza.error.log
```

Generic nginx problems:

```bash
sudo nginx -t
sudo systemctl status nginx
```

---

## 15. Updating the app

When a new commit lands on `main`:

```bash
cd /opt/lessenza/app \
  && sudo -u lessenza git pull --ff-only \
  && sudo -u lessenza npm ci --omit=dev --no-audit --no-fund \
  && sudo systemctl restart lessenza \
  && sudo journalctl -u lessenza -n 30 --no-pager
```

No `npm run build` needed. If the restart line in the log ends with
`[boot] L'Essenza server listening on http://127.0.0.1:3000` the update
succeeded. If not, roll back:

```bash
cd /opt/lessenza/app
sudo -u lessenza git reflog -5
sudo -u lessenza git reset --hard <previous-sha>
sudo systemctl restart lessenza
```

---

## 16. Backups

SQLite supports a safe online `.backup` that works while the app is running.
Create a backup directory and a nightly cron:

```bash
sudo mkdir -p /var/backups/lessenza
sudo chown lessenza:lessenza /var/backups/lessenza
sudo chmod 700 /var/backups/lessenza
```

Add the cron (runs 03:17 every night, keeps 30 days):

```bash
sudo crontab -u lessenza -e
```

Paste (on the editor that opens):

```
17 3 * * * /usr/bin/sqlite3 /opt/lessenza/app/data/lessenza.db ".backup '/var/backups/lessenza/lessenza-$(date +\%F).db'" && find /var/backups/lessenza -name 'lessenza-*.db' -mtime +30 -delete
```

Save and exit. Verify the cron registered:

```bash
sudo crontab -u lessenza -l
```

Test the backup command manually once:

```bash
sudo -u lessenza sqlite3 /opt/lessenza/app/data/lessenza.db ".backup '/var/backups/lessenza/test.db'"
ls -la /var/backups/lessenza/
sudo rm /var/backups/lessenza/test.db
```

### Off-site copy (optional but recommended)

Sign up for any cheap off-site object store (Hetzner Storage Box, Backblaze
B2, Wasabi). Install `rclone` and add a second nightly cron:

```bash
sudo apt-get install -y rclone
sudo -u lessenza rclone config     # one-time interactive setup
```

Then add to the lessenza crontab:

```
37 3 * * * /usr/bin/rclone copy /var/backups/lessenza/ remote:lessenza-backups/ --max-age 2d
```

Only the last 2 days' backups sync — saves bandwidth.

---

## 17. Decommission Netlify

Do this only **after** you've verified end-to-end on Hetzner for at least 24h
(one overnight cron cycle, one day of bookings).

1. **DNS** — already done in Step 1. Re-verify nothing still points at Netlify:

   ```bash
   dig +short lessenza.me
   dig +short www.lessenza.me
   # Both must be your Hetzner IP.
   ```

2. **Netlify site** — Netlify dashboard → site `lessenza-web` (or whatever
   name) → Site configuration → **Danger zone → Delete site**. Or if you want
   a safety net for a week, just pause builds:
   Site configuration → Build & deploy → Stop auto-publishing.

3. **Netlify env vars** — same dashboard → Site configuration → Environment
   variables. Remove all (they follow the site when deleted, but if you
   paused, clean them up: `JWT_SECRET`, `ADMIN_PASSWORD_HASH`, `SITE_URL`,
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `RESEND_API_KEY`,
   `SETUP_TOKEN`, and any Netlify Blobs tokens).

4. **Netlify Blobs** — if you keep the site paused, the blobs store is still
   around. Deleting the site removes it too. No action needed otherwise.

5. **Repo cleanup** (optional) — you can leave `netlify.toml` and
   `netlify/functions/` in place; they harmlessly double as the function
   bodies that `server/index.ts` mounts in Express. If you want to sever the
   tie entirely, that's a dedicated cleanup PR (not needed to operate).

6. **GitHub integration** — Netlify's GitHub app permissions can be removed
   at: https://github.com/settings/installations — find "Netlify", Configure,
   remove the `lessenza-web` repo. Optional.

---

## Appendix A. Troubleshooting

| Symptom                              | First thing to check                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| 502 Bad Gateway                      | `systemctl status lessenza` — is the Node app running?     |
| 500 on /api/* but static 200         | `journalctl -u lessenza -n 100` — stack trace in there     |
| Booking email never arrives          | Typo in `SMTP_PASS`; also check journal for `smtp` errors  |
| Let's Encrypt renewal fails          | `/var/www/certbot` dir exists? `systemctl status certbot.timer` |
| `/admin/setup` returns 401           | `SETUP_TOKEN` line missing or mismatched in `.env`         |
| Google Calendar stopped syncing      | `/admin/` → Google tab → reconnect; refresh token expired  |
| Disk full                            | `du -sh /var/backups/lessenza` — cron should prune; also nginx logs under `/var/log/nginx` |

## Appendix B. Rollback to Netlify (if something's badly broken)

1. Flip the DNS A records back to Netlify's IP (Netlify dashboard → Domains →
   "Check DNS configuration" shows the target).
2. On Hetzner: `sudo systemctl stop lessenza` and
   `sudo rm /etc/nginx/sites-enabled/lessenza && sudo systemctl reload nginx`.
3. Wait for DNS TTL to expire (5 min if you set TTL=300, longer if old TTL
   was larger).
4. Traffic goes back to Netlify. Your Hetzner SQLite DB is untouched — you
   can restart the service and re-cutover after fixing the issue.

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

## 18. VAPID keys for push notifications

The PWA push channel (owner gets a notification on every new booking) needs
one pair of VAPID keys. Generate once on any machine:

```bash
npx web-push generate-vapid-keys
```

Add to `/opt/lessenza/app/.env`:

```
VAPID_PUBLIC_KEY=<BBxxx...>
VAPID_PRIVATE_KEY=<xxx...>
VAPID_SUBJECT=mailto:info@lessenza.me
```

Then `systemctl restart lessenza`. Open `/admin/` on the phone (install the
PWA via Safari/Chrome "Add to Home Screen"), go to Podešavanja → Promjena
lozinke (the same accordion holds 2FA + push), tap "Uključi notifikacije" and
allow the browser permission prompt. Stale subscriptions (browser
uninstalled, permission revoked) are auto-cleaned on the next failed send.
