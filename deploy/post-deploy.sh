#!/usr/bin/env bash
# One-shot deploy script — run on the Hetzner VPS as root.
# Usage: paste this entire block into the Hetzner web console.
set -euo pipefail

APP=/opt/lessenza/app
cd "$APP"

echo "==> 1/5 git pull"
sudo -u lessenza git pull --ff-only

echo "==> 2/5 install + rebuild sharp (native binary for Linux x64)"
sudo -u lessenza npm ci
sudo -u lessenza npm rebuild sharp

echo "==> 3/5 patch .env with VAPID keys (only if not already set)"
if ! grep -q "^VAPID_PUBLIC_KEY=." "$APP/.env" 2>/dev/null; then
  cat >> "$APP/.env" <<'EOF'

# --- Push notifications (PWA) ---
VAPID_PUBLIC_KEY=BC8NbNLCiJD6WeTjrZcrF7RfeyWhdqRHxOSU42Th2zAdlimn-fCbcNT_s4ra3Zi8YATZp5DCwHpeopQn7kkAF_U
VAPID_PRIVATE_KEY=mU9OEiBMEcCiXYhnyn2UUnT4dP2RrUQI5TExyllB7Ro
VAPID_SUBJECT=mailto:info@lessenza.me
EOF
  echo "    VAPID keys appended."
else
  echo "    VAPID already present — skipped."
fi

echo "==> 4/5 reload nginx (new 20m client_max_body_size)"
cp "$APP/deploy/nginx-lessenza.conf" /etc/nginx/sites-available/lessenza
nginx -t
systemctl reload nginx

echo "==> 5/5 restart lessenza service"
systemctl restart lessenza
sleep 2
systemctl status lessenza --no-pager | head -10

echo ""
echo "✅ Deploy done. Check /var/log/lessenza-app.log for runtime errors."
