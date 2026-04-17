# L'Essenza — Migration runbook: Netlify → Hetzner VPS

This is the step-by-step for moving `lessenza.me` off Netlify onto a self-hosted
Node server on your existing Hetzner box. The site stays on the same domain;
only the backend infra moves.

---

## 0. Prerequisites on the Hetzner box

You need:

- Ubuntu 22.04 / 24.04 or Debian 12 (any recent Linux is fine)
- Root or sudo access
- At least **512MB free RAM** and **1GB free disk** (trivial — the app uses ~100MB)
- Ports 80 and 443 reachable from the internet
- Two existing sites already on this box using nginx? Good — we plug into the existing nginx, we don't replace it.

**Pre-flight check — do this first, it's read-only:**

```bash
ssh your-user@your-hetzner
git clone https://github.com/xmzvk4fcbs-cyber/lessenza-web.git /tmp/lessenza-web
bash /tmp/lessenza-web/deploy/preflight.sh
```

It prints what's already installed, what setup.sh will install, flags any
port conflicts, and refuses to let you proceed if anything is broken.
If you see all ✓/⚠ (no ✗), you're good to continue.

---

## 1. Pull the code onto the server

```bash
# As root (or sudo -i):
apt-get install -y git
git clone https://github.com/xmzvk4fcbs-cyber/lessenza-web.git /tmp/lessenza-web
bash /tmp/lessenza-web/deploy/setup.sh
```

`setup.sh` will:

- Install Node 22, build tools, certbot, ufw (if missing)
- Create a `lessenza` system user
- Clone the repo into `/opt/lessenza/app`
- `npm ci --omit=dev` there
- Generate a fresh `.env` with a new `JWT_SECRET`
- Install the `lessenza.service` systemd unit
- Install the nginx vhost at `/etc/nginx/sites-available/lessenza`

**It does NOT start the service yet** — you need to do two things first:
migrate data (Step 2) and configure DNS/TLS (Steps 3–4).

---

## 2. Migrate Netlify Blobs → SQLite

This is a one-shot copy. Run it on your **Mac** (not the server), pointed at Netlify:

```bash
# 2a. Get credentials from Netlify dashboard:
#     Site settings → Blobs → "Create personal access token"
#     Site settings → General → Site ID

cd ~/Projects/lessenza

NETLIFY_SITE_ID=xxxxxxxx-your-site-id \
NETLIFY_BLOBS_TOKEN=xxxxxxxxx-the-token \
LESSENZA_DB_PATH=./migration.db \
npx tsx deploy/migrate-from-blobs.ts

# 2b. SCP the resulting migration.db onto the server:
scp migration.db  root@your-hetzner:/opt/lessenza/app/data/lessenza.db
ssh root@your-hetzner 'chown lessenza:lessenza /opt/lessenza/app/data/lessenza.db'
```

After this, the SQLite db contains your admin password record, all services,
working hours, settings, inquiries, day-notes, and anything else that was in
Netlify Blobs.

---

## 3. Bring up the service (still on a test subdomain)

Before switching `lessenza.me`, test on a subdomain so you can roll back
instantly if something breaks.

```bash
# 3a. On the server, edit the vhost so it uses a test name:
sudo sed -i 's/lessenza.me www.lessenza.me/test.lessenza.me/' /etc/nginx/sites-enabled/lessenza

# 3b. Add DNS in Netlify (before switching):
#     A   test.lessenza.me → <hetzner-ip>    (TTL 300)

# 3c. Issue Let's Encrypt cert:
sudo certbot --nginx -d test.lessenza.me

# 3d. Start the Node app:
sudo systemctl enable --now lessenza
sudo systemctl status lessenza
journalctl -u lessenza -n 50 --no-pager

# 3e. Smoke test every endpoint at once:
BASE_URL=https://test.lessenza.me bash /opt/lessenza/app/deploy/smoke-test.sh

# 3f. Open https://test.lessenza.me — verify:
#     - Public site renders (images, booking page)
#     - /admin/ login works with the current password
#     - Creating a test booking shows up in Google Calendar
```

If smoke-test.sh fails anything, come find me before continuing.

---

## 4. Google OAuth redirect URI

Google OAuth is pinned to the callback URL registered in Google Cloud Console.
Since the domain stays the same (`lessenza.me`), **nothing to change there**.

But while testing on `test.lessenza.me`, the OAuth callback `/api/admin/google-callback`
won't match Google's allowlist. Either:

- Add `https://test.lessenza.me/api/admin/google-callback` to Google Cloud Console
  → APIs & Services → Credentials → OAuth 2.0 → Authorized redirect URIs
- OR skip OAuth test during Step 3 and rely on migrated tokens (they keep working
  because they're just a `refresh_token` stored in the DB).

---

## 5. DNS cutover

Once the test subdomain works end-to-end:

```bash
# 5a. In Netlify DNS, lower TTL for the A records to 60s, wait 10 minutes.
# 5b. Switch the A records:
#     A  lessenza.me     → <hetzner-ip>
#     A  www.lessenza.me → <hetzner-ip>
# 5c. On the server, restore the original vhost names + re-run certbot:
sudo sed -i 's/test.lessenza.me/lessenza.me www.lessenza.me/' /etc/nginx/sites-enabled/lessenza
sudo certbot --nginx -d lessenza.me -d www.lessenza.me --expand
sudo systemctl reload nginx
# 5d. Drop the Netlify deploy hook (or just let it sit; it doesn't cost anything).
```

Propagation: usually 5–30 min for Netlify DNS; possibly up to 24h for caches
of people who visited recently. Both old (Netlify) and new (Hetzner) serve the
site during the overlap — there's no downtime window.

---

## 6. Operations

### Start / stop / restart
```bash
sudo systemctl restart lessenza
sudo systemctl status lessenza
```

### Logs
```bash
journalctl -u lessenza -f             # live tail
journalctl -u lessenza --since "1h ago"
tail -f /var/log/nginx/lessenza.{access,error}.log
```

### Update the code
```bash
sudo -u lessenza git -C /opt/lessenza/app pull --ff-only
sudo -u lessenza bash -c 'cd /opt/lessenza/app && npm ci --omit=dev'
sudo systemctl restart lessenza
```

### Backup SQLite (run nightly via cron)
```bash
sudo -u lessenza sqlite3 /opt/lessenza/app/data/lessenza.db ".backup /opt/lessenza/app/data/backup-$(date +%F).db"
# or simpler:  cp lessenza.db lessenza-$(date +%F).db  (SQLite + WAL supports safe hot copy of the main file + -wal + -shm trio)
```

Add to root's crontab:
```
0 3 * * *  sqlite3 /opt/lessenza/app/data/lessenza.db ".backup /opt/lessenza/app/data/backup-$(date +\%F).db" && find /opt/lessenza/app/data -name 'backup-*.db' -mtime +7 -delete
```

### Pointer from nginx to Node: which port?
By default `PORT=3000` in `.env`. If your other sites already use 3000, edit `.env`
to use any free port (e.g. 3010) AND edit `/etc/nginx/sites-enabled/lessenza` to
match, then `sudo systemctl restart lessenza && sudo nginx -s reload`.

---

## 7. Rollback (if something breaks during cutover)

- DNS: in Netlify DNS, revert the A record to the Netlify target. That pushes
  traffic back to Netlify immediately once caches expire.
- Netlify: the Netlify deploy is still there untouched — nothing is deleted
  on their side. Site just stops receiving traffic.
- SQLite data: if any bookings happened on the new server between cutover and
  rollback, pull them back: export via the admin `/admin/` exports (or direct
  SQL copy of the `kv` rows) and re-insert into Netlify Blobs manually. Very
  unlikely to be needed unless you run on the new server for hours before
  rolling back.

---

## Server sizing — can my current Hetzner handle a third site?

Rough memory footprint of this app in production:

| Part                 | RAM         | CPU (idle) | Disk (1 yr) |
|----------------------|-------------|------------|-------------|
| Node + Express       | 90–140 MB   | 0%         | –           |
| SQLite WAL pages     | 5–20 MB     | 0%         | 5–20 MB     |
| Static file serving  | OS cache    | 0%         | 50 MB       |
| Nginx child workers  | +8 MB       | 0%         | –           |
| **Total**            | **~150 MB** | 0%         | ~70 MB      |

CX11 (2 GB RAM) with two modest sites already running → plenty of headroom.
Load stays near zero most of the day; spikes of booking traffic (even 100 concurrent
users) still stay under 1% CPU.

If it ever does get tight, the bottleneck will almost certainly be your *other*
site, not this one. `htop` + `free -h` will tell you.
