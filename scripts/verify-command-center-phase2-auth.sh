#!/usr/bin/env bash
set -euo pipefail

# ISOLATED DATABASE AND APPLICATION ONLY.

DB_URL="${1:-}"
APP_URL="${2:-}"
OPERATOR_HOST="${3:-ops.phase2.local}"

if [[ "$DB_URL" != *"@127.0.0.1:"* && "$DB_URL" != *"@localhost:"* ]]; then
  echo "Refusing a non-loopback database." >&2
  exit 1
fi
if [[ "$APP_URL" != http://127.0.0.1:* && "$APP_URL" != http://localhost:* ]]; then
  echo "Refusing a non-loopback application." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -f "$SCRIPT_DIR/seed-command-center-phase2-auth.sql" >/dev/null

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

request() {
  local token="$1"
  local path="$2"
  local output="$3"
  shift 3
  curl --silent --show-error \
    --output "$output" \
    --write-out '%{http_code}' \
    --header "Host: ${OPERATOR_HOST}" \
    --header "Cookie: __Host-scalesafe_ops=${token}" \
    "$@" \
    "${APP_URL}${path}"
}

assert_status() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  local body="$4"
  if [[ "$actual" != "$expected" ]]; then
    echo "${label}: expected ${expected}, received ${actual}" >&2
    cat "$body" >&2
    exit 1
  fi
}

STATUS="$(request phase2-owner-session '/internal/operator/api/health?limit=50' "$TMP_DIR/owner-health.json")"
assert_status 200 "$STATUS" 'platform owner health' "$TMP_DIR/owner-health.json"

STATUS="$(request phase2-reseller-session '/internal/operator/api/health?limit=50' "$TMP_DIR/reseller-health.json")"
assert_status 404 "$STATUS" 'reseller platform health' "$TMP_DIR/reseller-health.json"

STATUS="$(request phase2-reseller-session '/internal/operator/api/merchants/cc-auth-assigned' "$TMP_DIR/assigned.json")"
assert_status 200 "$STATUS" 'assigned merchant' "$TMP_DIR/assigned.json"

STATUS="$(request phase2-reseller-session '/internal/operator/api/merchants/cc-auth-unassigned' "$TMP_DIR/unassigned.json")"
assert_status 404 "$STATUS" 'unassigned merchant' "$TMP_DIR/unassigned.json"
STATUS="$(request phase2-reseller-session '/internal/operator/api/merchants/cc-auth-does-not-exist' "$TMP_DIR/absent.json")"
assert_status 404 "$STATUS" 'absent merchant' "$TMP_DIR/absent.json"
cmp --silent "$TMP_DIR/unassigned.json" "$TMP_DIR/absent.json" || {
  echo "Unassigned and absent merchant responses differ" >&2
  exit 1
}

STATUS="$(request phase2-owner-session '/internal/operator/api/session' "$TMP_DIR/mixed.json" --header 'x-sso-payload: merchant-plane')"
assert_status 400 "$STATUS" 'mixed identity planes' "$TMP_DIR/mixed.json"

STATUS="$(request phase2-support-session '/internal/operator/api/merchants/cc-auth-assigned' "$TMP_DIR/support-granted.json")"
assert_status 200 "$STATUS" 'active support grant' "$TMP_DIR/support-granted.json"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  UPDATE operator_support_grants
  SET starts_at = clock_timestamp() - interval '2 hours',
      expires_at = clock_timestamp() - interval '1 hour'
  WHERE id = '20000000-0000-4000-8000-000000000041';" >/dev/null
STATUS="$(request phase2-support-session '/internal/operator/api/merchants/cc-auth-assigned' "$TMP_DIR/support-expired.json")"
assert_status 404 "$STATUS" 'expired support grant' "$TMP_DIR/support-expired.json"

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  UPDATE operator_users
  SET status = 'disabled'
  WHERE id = '20000000-0000-4000-8000-000000000023';" >/dev/null
STATUS="$(request phase2-reseller-session '/internal/operator/api/session' "$TMP_DIR/disabled-user.json")"
assert_status 401 "$STATUS" 'disabled operator user' "$TMP_DIR/disabled-user.json"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  UPDATE operator_users
  SET status = 'active'
  WHERE id = '20000000-0000-4000-8000-000000000023';" >/dev/null

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  UPDATE operator_memberships
  SET status = 'revoked', ended_at = clock_timestamp()
  WHERE id = '20000000-0000-4000-8000-000000000033';" >/dev/null
STATUS="$(request phase2-reseller-session '/internal/operator/api/session' "$TMP_DIR/revoked-membership.json")"
assert_status 401 "$STATUS" 'revoked operator membership' "$TMP_DIR/revoked-membership.json"
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  UPDATE operator_memberships
  SET status = 'active', ended_at = NULL
  WHERE id = '20000000-0000-4000-8000-000000000033';" >/dev/null

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  UPDATE operator_sessions
  SET revoked_at = clock_timestamp(),
      revoked_by_operator_user_id = '20000000-0000-4000-8000-000000000021',
      revocation_reason = 'Phase 2 verification'
  WHERE id = '20000000-0000-4000-8000-000000000054';" >/dev/null
STATUS="$(request phase2-revoked-session '/internal/operator/api/session' "$TMP_DIR/revoked-session.json")"
assert_status 401 "$STATUS" 'revoked operator session' "$TMP_DIR/revoked-session.json"

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -c "
  SELECT transfer_primary_reseller_assignment(
    'cc-auth-assigned',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000021',
    'Phase 2 immediate transfer verification',
    gen_random_uuid()
  );" >/dev/null
STATUS="$(request phase2-reseller-session '/internal/operator/api/merchants/cc-auth-assigned' "$TMP_DIR/transferred.json")"
assert_status 404 "$STATUS" 'transferred assignment' "$TMP_DIR/transferred.json"

AUDIT_COUNTS="$(
  psql "$DB_URL" -X -Atc "
    SELECT
      count(*) FILTER (WHERE result = 'allowed'),
      count(*) FILTER (WHERE result = 'denied')
    FROM operator_audit_events
    WHERE occurred_at >= clock_timestamp() - interval '10 minutes';"
)"
IFS='|' read -r ALLOWED_AUDITS DENIED_AUDITS <<<"$AUDIT_COUNTS"
if (( ALLOWED_AUDITS < 3 || DENIED_AUDITS < 4 )); then
  echo "Expected attributed allow/deny audits, received ${AUDIT_COUNTS}" >&2
  exit 1
fi

echo "AUTHORIZATION VERIFIED: platform-only health, live assignments and grants, immediate revocation, mixed-plane rejection, indistinguishable 404s, and attributed audits"
