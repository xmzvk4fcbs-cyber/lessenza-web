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

set -euo pipefail
LOG=/var/log/lessenza-backup.log
APP_DIR=/opt/lessenza/app
ENV_FILE=/etc/lessenza-backup.env
TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
SNAPSHOT_DIR="${APP_DIR}/data/snapshots/${TS}"

fail() {
  echo "[$(date -Iseconds)] FAIL: $1" >> "${LOG}"
  exit 1
}

if [[ ! -f "${ENV_FILE}" ]]; then fail "missing ${ENV_FILE}"; fi
# shellcheck disable=SC1090
source "${ENV_FILE}"

mkdir -p "${SNAPSHOT_DIR}"

# 1. SQLite atomic snapshot (works even while server is running thanks to WAL).
if ! sudo -u lessenza sqlite3 "${APP_DIR}/data/lessenza.db" \
     ".backup '${SNAPSHOT_DIR}/lessenza.db'" >> "${LOG}" 2>&1; then
  fail "sqlite3 .backup failed"
fi

# 2. Tar uploads (avoid touching live writes — sharp may be writing).
if [[ -d "${APP_DIR}/uploads" ]]; then
  if ! sudo -u lessenza tar czf "${SNAPSHOT_DIR}/uploads.tar.gz" \
       -C "${APP_DIR}" uploads >> "${LOG}" 2>&1; then
    fail "tar uploads failed"
  fi
fi

# 3. Rsync to Storage Box (rsync mirrors snapshots/, server keeps last 14 locally).
if ! rsync -az --partial -e "ssh -i ${BACKUP_KEY} -o StrictHostKeyChecking=accept-new" \
     "${SNAPSHOT_DIR}/" \
     "${BACKUP_USER}@${BACKUP_HOST}:${BACKUP_REMOTE_DIR}/snapshots/${TS}/" \
     >> "${LOG}" 2>&1; then
  fail "rsync to Storage Box failed"
fi

# 4. Local rotation: keep 14 most recent snapshot dirs, drop older.
find "${APP_DIR}/data/snapshots" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} + || true

echo "[$(date -Iseconds)] backup ${TS} done" >> "${LOG}"
