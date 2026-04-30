#!/usr/bin/env bash
# One-shot post-deploy script for the Hetzner VPS.
# Paste this entire block into the Hetzner web console as root.
# Idempotent — safe to run multiple times.
set -euo pipefail

APP=/home/valentina/lessenza-web
USER_NAME=valentina

echo "==> 1/6 git pull (latest main)"
sudo -u "$USER_NAME" git -C "$APP" pull --ff-only

echo "==> 2/6 npm install + sharp rebuild for Linux x64"
sudo -u "$USER_NAME" npm --prefix "$APP" install --omit=dev --no-audit --no-fund | tail -3
sudo -u "$USER_NAME" npm --prefix "$APP" rebuild sharp | tail -3 || echo "[warn] sharp rebuild non-fatal"

echo "==> 3/6 patch .env with VAPID keys (only if missing)"
if ! sudo grep -q "^VAPID_PUBLIC_KEY=." "$APP/.env" 2>/dev/null; then
  sudo -u "$USER_NAME" tee -a "$APP/.env" >/dev/null <<'EOF'

# --- Push notifications (PWA) ---
VAPID_PUBLIC_KEY=BC8NbNLCiJD6WeTjrZcrF7RfeyWhdqRHxOSU42Th2zAdlimn-fCbcNT_s4ra3Zi8YATZp5DCwHpeopQn7kkAF_U
VAPID_PRIVATE_KEY=mU9OEiBMEcCiXYhnyn2UUnT4dP2RrUQI5TExyllB7Ro
VAPID_SUBJECT=mailto:info@lessenza.me
EOF
  echo "    VAPID appended."
else
  echo "    VAPID already set — skipped."
fi

echo "==> 4/6 grant valentina sudo NOPASSWD for nginx reload (one-time)"
SUDOERS=/etc/sudoers.d/lessenza-deploy
if [[ ! -f "$SUDOERS" ]]; then
  cat > "$SUDOERS" <<'EOF'
# Scoped NOPASSWD entries for webhook-deploy.sh
valentina ALL=(root) NOPASSWD: /bin/systemctl restart lessenza
valentina ALL=(root) NOPASSWD: /bin/systemctl reload nginx
valentina ALL=(root) NOPASSWD: /usr/sbin/nginx -t
valentina ALL=(root) NOPASSWD: /bin/cp /home/valentina/lessenza-web/deploy/nginx-lessenza.conf /etc/nginx/sites-available/lessenza
EOF
  chmod 440 "$SUDOERS"
  visudo -c -f "$SUDOERS" && echo "    sudoers OK."
else
  echo "    sudoers entry exists — skipped."
fi

echo "==> 5/6 reload nginx with new 20m client_max_body_size"
cp "$APP/deploy/nginx-lessenza.conf" /etc/nginx/sites-available/lessenza
nginx -t
systemctl reload nginx
echo "    nginx reloaded."

echo "==> 6/6 restart lessenza service"
systemctl restart lessenza
sleep 2
systemctl is-active lessenza && echo "    lessenza: active"
sleep 1
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || echo "err")
echo "    health: $HEALTH (200 = ok)"

echo ""
echo "✅ Deploy complete. Future pushes will auto-deploy via webhook"
echo "   (which now also rebuilds sharp + reloads nginx on config changes)."
