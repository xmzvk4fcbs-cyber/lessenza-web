#!/usr/bin/env bash
# Emergency rollback: stop the Node app + disable its nginx vhost so the box
# goes back to only serving the OTHER sites you already had.
#
# Use this when the cutover has problems and you want traffic to stop hitting
# our app immediately while you move DNS back to Netlify.
#
#   sudo bash deploy/rollback.sh
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash $0)" >&2
  exit 1
fi

echo "==> Stopping lessenza systemd service..."
systemctl stop lessenza 2>/dev/null || true
systemctl disable lessenza 2>/dev/null || true

echo "==> Disabling lessenza nginx vhost..."
if [[ -L /etc/nginx/sites-enabled/lessenza ]]; then
  rm /etc/nginx/sites-enabled/lessenza
fi

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "==> Nginx reloaded — lessenza.me is no longer served from this box."
else
  echo "⚠  Nginx config test failed after removing vhost — check /etc/nginx/ manually." >&2
  exit 2
fi

echo
echo "Next step: in Netlify DNS, revert the A records for lessenza.me back to"
echo "the Netlify target. Traffic will return to Netlify once DNS caches expire"
echo "(usually < 5 min if TTL was lowered beforehand)."
echo
echo "The Node app and its SQLite DB are untouched — you can re-enable with:"
echo "  sudo systemctl enable --now lessenza"
echo "  sudo ln -s /etc/nginx/sites-available/lessenza /etc/nginx/sites-enabled/"
echo "  sudo systemctl reload nginx"
