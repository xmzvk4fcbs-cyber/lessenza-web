#!/usr/bin/env bash
# Phase 2: after DNS points at this server, run this to get SSL + HTTPS redirect.
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/xmzvk4fcbs-cyber/lessenza-web/main/deploy/finalize.sh)
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root." >&2
  exit 1
fi

EMAIL="${LE_EMAIL:-vujovicvalentinaa9@gmail.com}"

# Sanity: does DNS resolve to this server's public IP?
MY_IP=$(curl -s4 ifconfig.me || true)
DOMAIN_IP=$(dig +short lessenza.me A | tail -n1 || true)
echo "This server's public IP: ${MY_IP}"
echo "lessenza.me currently resolves to: ${DOMAIN_IP:-<empty>}"
if [[ -n "${MY_IP}" && -n "${DOMAIN_IP}" && "${MY_IP}" != "${DOMAIN_IP}" ]]; then
  echo
  echo "  ⚠  DNS does not yet point at this server. Let's Encrypt will refuse."
  echo "     Update the A records at your registrar, wait ~10 min, then re-run."
  echo "     Continuing anyway in case you're using DNS-01 or Cloudflare proxying..."
  echo
fi

echo "==> certbot --nginx"
certbot --nginx \
  -d lessenza.me -d www.lessenza.me \
  --non-interactive --agree-tos --redirect \
  -m "${EMAIL}"

echo
echo "==> reload nginx + restart app"
nginx -t
systemctl reload nginx
systemctl restart lessenza
sleep 2

echo
echo "=========================================================="
echo "  Live: https://lessenza.me"
echo "  Admin: https://lessenza.me/admin/  (first-run: /admin/setup)"
echo "  Logs:  journalctl -u lessenza -f"
echo "  Cert renew (auto): systemctl status certbot.timer"
echo "=========================================================="
