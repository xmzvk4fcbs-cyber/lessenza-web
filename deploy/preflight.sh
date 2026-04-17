#!/usr/bin/env bash
# Pre-flight check for the Hetzner target box.
# Run this BEFORE setup.sh. It's read-only — nothing is installed or changed.
#
#   bash deploy/preflight.sh
#
# Prints:
#   ✓ things that look fine
#   ⚠ things to confirm
#   ✗ hard blockers (fix before running setup.sh)

set -u

PASS=0
WARN=0
FAIL=0

ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; PASS=$((PASS+1)); }
warn() { printf "  \033[33m⚠\033[0m %s\n" "$*"; WARN=$((WARN+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$*"; FAIL=$((FAIL+1)); }

hdr()  { printf "\n\033[1m%s\033[0m\n" "$*"; }

hdr "OS"
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian) ok "Distro: ${PRETTY_NAME}" ;;
    *)             warn "Distro: ${PRETTY_NAME:-unknown} — setup.sh tested on Ubuntu/Debian" ;;
  esac
else
  bad "No /etc/os-release — can't detect distro"
fi

hdr "Resources"
MEM_AVAIL_MB=$(free -m | awk '/^Mem:/ {print $7}')
if   (( MEM_AVAIL_MB >= 400 )); then ok "RAM available: ${MEM_AVAIL_MB} MB"
elif (( MEM_AVAIL_MB >= 200 )); then warn "RAM available: ${MEM_AVAIL_MB} MB (app wants ~150 MB; ok but tight)"
else                                 bad "RAM available: ${MEM_AVAIL_MB} MB — not enough"; fi

DISK_FREE_GB=$(df -BG / | awk 'NR==2 {gsub("G",""); print $4}')
if   (( DISK_FREE_GB >= 2 ));  then ok "Disk free on /: ${DISK_FREE_GB} GB"
else                                 warn "Disk free on /: ${DISK_FREE_GB} GB"; fi

LOAD=$(uptime | awk -F'load average:' '{print $2}' | awk -F, '{gsub(" ",""); print $1}')
if [[ -n "$LOAD" ]]; then
  if (( $(awk "BEGIN{print ($LOAD < 1.0)}") )); then ok "Load avg (1m): ${LOAD}"
  else warn "Load avg (1m): ${LOAD} — box is busy, app will still fit but monitor"; fi
fi

hdr "Network"
if command -v ss >/dev/null 2>&1; then
  for p in 80 443; do
    if ss -Htlnp "sport = :$p" | grep -q .; then
      ok  "Port $p already listening (likely nginx) — we'll plug into it"
    else
      warn "Port $p NOT listening — setup.sh will install nginx to cover it"
    fi
  done
  if ss -Htlnp "sport = :3000" | grep -q .; then
    warn "Port 3000 already in use by another process — edit .env PORT after setup"
  else
    ok  "Port 3000 free for our Node app"
  fi
else
  warn "ss not installed — can't audit listening ports"
fi

hdr "Services already running"
if command -v nginx >/dev/null 2>&1; then
  ok  "nginx: $(nginx -v 2>&1 | awk -F/ '{print $2}')"
  if nginx -t 2>/dev/null; then ok "nginx config currently valid"
  else warn "nginx -t fails; fix existing config before adding lessenza"; fi
  SITES=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -v '^default$' | wc -l | tr -d ' ')
  ok  "Existing enabled vhosts: ${SITES}"
else
  warn "nginx not installed — setup.sh will install it"
fi

if command -v node >/dev/null 2>&1; then
  NODE_VER=$(node -v)
  if [[ "${NODE_VER#v}" > "19" ]]; then ok "Node ${NODE_VER}"
  else warn "Node ${NODE_VER} — setup.sh will upgrade to 22.x"; fi
else
  warn "Node not installed — setup.sh will install 22.x"
fi

command -v git    >/dev/null && ok "git installed"           || warn "git missing — setup.sh installs it"
command -v sqlite3 >/dev/null && ok "sqlite3 CLI installed"  || warn "sqlite3 CLI missing (app uses better-sqlite3 directly; CLI is just for backups)"
command -v certbot >/dev/null && ok "certbot installed"      || warn "certbot missing — setup.sh installs it"

hdr "User"
if id lessenza >/dev/null 2>&1; then warn "'lessenza' user already exists — setup.sh will skip creation"
else ok "'lessenza' user free to create"; fi

if [[ -d /opt/lessenza/app ]]; then warn "/opt/lessenza/app already exists — setup.sh will fetch updates instead of clone"
else ok "/opt/lessenza/app free to create"; fi

hdr "Firewall"
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
  if ufw status | grep -qE '^(80|443|Nginx)'; then ok "ufw active and already allows web traffic"
  else warn "ufw active but 80/443 not open — run: sudo ufw allow 'Nginx Full'"; fi
else
  ok "ufw inactive or not installed — not blocking anything"
fi

hdr "Summary"
printf "  pass %d · warn %d · fail %d\n" "$PASS" "$WARN" "$FAIL"
if (( FAIL > 0 )); then
  echo
  echo "  🛑 Fix the ✗ items before running setup.sh."
  exit 1
fi
echo
echo "  Ready. Run:  sudo bash deploy/setup.sh"
