#!/usr/bin/env bash
# Called by the /api/hooks-deploy endpoint after a verified GitHub push to main.
# Runs as the valentina user (because the Node process runs as valentina).
#
# Responsibilities:
#   - git pull (uses SSH deploy key at ~/.ssh/github_lessenza)
#   - npm install if package-lock changed
#   - sudo systemctl restart lessenza (scoped NOPASSWD entry)
#
# Output is appended to /tmp/lessenza-deploy.log — tail it to debug:
#   tail -f /tmp/lessenza-deploy.log

set -u  # not -e — we want to log errors, not silently exit
LOG=/tmp/lessenza-deploy.log
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Serialize concurrent deploys (two rapid pushes) with flock.
exec 200>"/tmp/lessenza-deploy.lock"
if ! flock -n 200; then
  echo "[$(date -Iseconds)] another deploy already running — exit" >> "$LOG"
  exit 0
fi

{
  echo ""
  echo "===== $(date -Iseconds) deploy start ====="
  cd "$APP_DIR" || { echo "cd failed"; exit 1; }

  # Pull latest main (deploy key configured in ~/.ssh/config as host 'github-lessenza')
  GIT_SSH_COMMAND="ssh -i $HOME/.ssh/github_lessenza -o StrictHostKeyChecking=accept-new" \
    git fetch --quiet origin main
  BEFORE=$(git rev-parse HEAD)
  git reset --hard origin/main
  AFTER=$(git rev-parse HEAD)
  echo "moved $BEFORE -> $AFTER"

  # Only npm install if dependency files changed in this update.
  if git diff --name-only "$BEFORE" "$AFTER" | grep -qE '^(package\.json|package-lock\.json)$'; then
    echo "dependencies changed — running npm install"
    npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
  fi

  # Restart the Node process (scoped NOPASSWD).
  sudo -n /bin/systemctl restart lessenza
  sleep 2
  STATUS=$(sudo -n /bin/systemctl is-active lessenza)
  echo "service: $STATUS"

  # Health check.
  sleep 2
  HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || echo "err")
  echo "health: $HEALTH"

  echo "===== $(date -Iseconds) deploy done ====="
} >> "$LOG" 2>&1
