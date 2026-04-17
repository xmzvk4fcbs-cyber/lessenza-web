#!/usr/bin/env bash
# First-time setup script for L'Essenza on a Debian/Ubuntu Hetzner VPS.
# Run as root (or with sudo).
#
#   ssh root@your-server
#   cd /tmp && git clone https://github.com/xmzvk4fcbs-cyber/lessenza-web.git
#   bash lessenza-web/deploy/setup.sh
#
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash $0)" >&2
  exit 1
fi

APP_USER=lessenza
APP_DIR=/opt/lessenza/app
DATA_DIR=/opt/lessenza/app/data
NODE_MAJOR=22
REPO_URL="${LESSENZA_REPO_URL:-https://github.com/xmzvk4fcbs-cyber/lessenza-web.git}"

echo "==> 1/7  Installing base packages..."
apt-get update
apt-get install -y curl ca-certificates gnupg git build-essential python3 nginx ufw certbot python3-certbot-nginx

echo "==> 2/7  Installing Node ${NODE_MAJOR}.x..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" != "${NODE_MAJOR}" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> 3/7  Creating ${APP_USER} system user..."
id "${APP_USER}" &>/dev/null || useradd --system --shell /usr/sbin/nologin --home-dir "${APP_DIR}" "${APP_USER}"
mkdir -p "${APP_DIR}" "${DATA_DIR}"
chown -R "${APP_USER}:${APP_USER}" "$(dirname "${APP_DIR}")"

echo "==> 4/7  Cloning or updating repo to ${APP_DIR}..."
if [[ ! -d "${APP_DIR}/.git" ]]; then
  sudo -u "${APP_USER}" git clone "${REPO_URL}" "${APP_DIR}"
else
  sudo -u "${APP_USER}" git -C "${APP_DIR}" fetch --all --prune
  sudo -u "${APP_USER}" git -C "${APP_DIR}" reset --hard origin/main
fi

echo "==> 5/7  Installing npm dependencies..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm ci --omit=dev --no-audit --no-fund"

echo "==> 6/7  Configuring .env (you will be prompted if one is missing)..."
if [[ ! -f "${APP_DIR}/.env" ]]; then
  JWT_RAND=$(openssl rand -hex 32)
  cat > "${APP_DIR}/.env" <<EOF
# Required
SELF_HOSTED=1
JWT_SECRET=${JWT_RAND}
SITE_URL=https://lessenza.me
PORT=3000
HOST=127.0.0.1

# Optional — set if you rotate from Netlify:
#   ADMIN_PASSWORD_HASH=bcrypt-hash-here   # bootstrap only; admin/change-password overrides in SQLite
#   RESEND_API_KEY=re_xxx                   # fallback if Google OAuth isn't connected
LESSENZA_DB_PATH=${DATA_DIR}/lessenza.db
EOF
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env"
  chmod 600 "${APP_DIR}/.env"
  echo "    Wrote fresh .env (JWT_SECRET generated). Review it before starting the service."
else
  echo "    .env already exists — not touching it."
fi

echo "==> 7/7  Installing systemd unit + nginx vhost..."
cp "${APP_DIR}/deploy/lessenza.service" /etc/systemd/system/lessenza.service
cp "${APP_DIR}/deploy/nginx-lessenza.conf" /etc/nginx/sites-available/lessenza
ln -sf /etc/nginx/sites-available/lessenza /etc/nginx/sites-enabled/lessenza
systemctl daemon-reload

nginx -t

echo
echo "=========================================================="
echo "  Base install done. Next steps:"
echo "    1. Point DNS: A  lessenza.me     → <server-ip>"
echo "                  A  www.lessenza.me → <server-ip>"
echo "    2. Reload nginx:  sudo systemctl reload nginx"
echo "    3. Issue cert:    sudo certbot --nginx -d lessenza.me -d www.lessenza.me"
echo "    4. Start app:     sudo systemctl enable --now lessenza"
echo "    5. Tail logs:     journalctl -u lessenza -f"
echo "=========================================================="
