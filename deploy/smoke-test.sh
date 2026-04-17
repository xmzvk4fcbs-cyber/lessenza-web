#!/usr/bin/env bash
# End-to-end smoke test against a running self-hosted server.
# Usage:  BASE_URL=http://127.0.0.1:3000 bash deploy/smoke-test.sh
#
# Verifies every public + admin endpoint responds with the expected shape
# (200 where anonymous access is allowed, 401 for admin without cookie).
# Exits non-zero if any check regresses — good for pre-cutover validation.

set -u

BASE="${BASE_URL:-http://127.0.0.1:3000}"
PASS=0
FAIL=0

ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; PASS=$((PASS+1)); }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$*"; FAIL=$((FAIL+1)); }

check() {
  local method="$1" url="$2" want="$3" desc="$4"
  local body="${5:-}"
  local got
  if [[ -n "$body" ]]; then
    got=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H 'content-type: application/json' -d "$body" "$BASE$url")
  else
    got=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "$BASE$url")
  fi
  if [[ "$got" == "$want" ]]; then
    ok  "$method $url → $got  ($desc)"
  else
    bad "$method $url → $got, expected $want  ($desc)"
  fi
}

printf "\n\033[1mTarget: %s\033[0m\n\n" "$BASE"

echo "== Static =="
check GET  /                   200 "home page"
check GET  /usluge.html        200 "services page"
check GET  /zakazivanje.html   200 "booking wizard"
check GET  /robots.txt         200 "robots"
check GET  /sitemap.xml        200 "sitemap"
check GET  /css/style.css      200 "stylesheet"
check GET  /img/favicon.ico    200 "favicon"
check GET  /admin/             200 "admin SPA"
check GET  /nonexistent-page   404 "404 page"

echo
echo "== Public API =="
check GET  /api/health                 200 "health"
check GET  /api/services               200 "services list"
check GET  /api/public-settings        200 "public settings"
check GET  /api/slots                  400 "slots w/o params (expects bad-request)"

echo
echo "== Admin API (no auth = 401) =="
check GET  /api/admin/appointments     401 "appointments requires auth"
check GET  /api/admin/inquiries        401 "inquiries requires auth"
check GET  /api/admin/settings         401 "settings requires auth"
check GET  /api/admin/services         401 "admin services requires auth"
check GET  /api/admin/day-view         401 "day-view requires auth"
check GET  /api/admin/working-hours    401 "hours requires auth"

echo
echo "== Method checks =="
check GET  /api/book                   405 "book rejects GET"
check GET  /api/inquiry                405 "inquiry rejects GET"

echo
printf "\n\033[1mSummary: %d passed, %d failed\033[0m\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
