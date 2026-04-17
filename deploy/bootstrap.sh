#!/usr/bin/env bash
# One-shot bootstrap for the Hetzner VPS. Paste this command in the Hetzner
# Cloud Console terminal (as root):
#
#   bash <(curl -fsSL https://raw.githubusercontent.com/xmzvk4fcbs-cyber/lessenza-web/main/deploy/bootstrap.sh)
#
# It runs deploy/setup.sh (installs Node/nginx/certbot, clones the repo,
# writes a base .env, installs systemd + nginx vhost), then prompts for the
# PrivateEmail SMTP password and appends the mailer block to /opt/lessenza/app/.env.
#
# It STOPS before issuing the Let's Encrypt cert because DNS for lessenza.me
# must point at this server first. After DNS flips, run:
#   bash <(curl -fsSL https://raw.githubusercontent.com/xmzvk4fcbs-cyber/lessenza-web/main/deploy/finalize.sh)
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root. In the Hetzner Cloud Console you already are — just paste again." >&2
  exit 1
fi

APP_DIR=/opt/lessenza/app

echo "==> Phase 1: base install"
bash <(curl -fsSL https://raw.githubusercontent.com/xmzvk4fcbs-cyber/lessenza-web/main/deploy/setup.sh)

echo
echo "==> Phase 2: PrivateEmail SMTP credentials"
echo "Mailbox user: info@lessenza.me"
read -r -s -p "Paste the mailbox password (input hidden), then Enter: " SMTP_PASS
echo
if [[ -z "${SMTP_PASS}" ]]; then
  echo "Empty password — skipping SMTP block. Re-run later to add it." >&2
else
  # Append SMTP block to the .env that setup.sh wrote.
  # Use a heredoc with escaped $ to avoid shell expansion on the password.
  if ! grep -q "^SMTP_HOST=" "${APP_DIR}/.env"; then
    cat >> "${APP_DIR}/.env" <<EOF

# PrivateEmail (Namecheap) SMTP — auto-selected by mailer when SMTP_HOST is set.
SMTP_HOST=mail.privateemail.com
SMTP_PORT=465
SMTP_USER=info@lessenza.me
SMTP_PASS=${SMTP_PASS}
SMTP_FROM="L'Essenza <info@lessenza.me>"
EOF
    chown lessenza:lessenza "${APP_DIR}/.env"
    chmod 600 "${APP_DIR}/.env"
    echo "  SMTP block appended to ${APP_DIR}/.env (mode 600)."
  else
    echo "  .env already has an SMTP_HOST line — leaving it alone."
  fi
fi

echo
echo "==> Phase 3: enable nginx vhost + start Node app on HTTP"
ln -sf /etc/nginx/sites-available/lessenza /etc/nginx/sites-enabled/lessenza
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl enable --now lessenza
sleep 2
systemctl status lessenza --no-pager | head -12 || true

echo
echo "=========================================================="
echo "  Phase 1 done. NEXT:"
echo ""
echo "  1. At your domain registrar, set the A records:"
echo "       lessenza.me      →  $(curl -s4 ifconfig.me || echo '46.224.158.221')"
echo "       www.lessenza.me  →  $(curl -s4 ifconfig.me || echo '46.224.158.221')"
echo "     (TTL 300. Wait 5–30 minutes for propagation.)"
echo ""
echo "  2. Verify DNS propagation:"
echo "       dig +short lessenza.me"
echo "     You want the IP above, not a Netlify IP."
echo ""
echo "  3. Issue the SSL cert + enable HTTPS redirect:"
echo "       bash <(curl -fsSL https://raw.githubusercontent.com/xmzvk4fcbs-cyber/lessenza-web/main/deploy/finalize.sh)"
echo ""
echo "  4. First-run admin setup:"
echo "       https://lessenza.me/admin/setup"
echo "     Use the SETUP_TOKEN printed below (also in ${APP_DIR}/.env)."
echo "=========================================================="
grep -E "^SETUP_TOKEN=" "${APP_DIR}/.env" | head -1 || echo "(SETUP_TOKEN not set — edit ${APP_DIR}/.env if you want bootstrap setup)"
echo
echo "  Logs (tail live):  journalctl -u lessenza -f"
echo "  Service status:    systemctl status lessenza"
echo "  App env file:      ${APP_DIR}/.env  (chmod 600, contains your SMTP password)"
