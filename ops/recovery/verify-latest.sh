#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export LC_ALL=C

ENV_FILE="${1:-/etc/scalesafe-recovery/backup.env}"

fail() {
  printf 'BACKUP HEALTH FAILED: %s\n' "$*" >&2
  exit 1
}

[[ -r "$ENV_FILE" ]] || fail "Cannot read environment file: $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

command -v jq >/dev/null 2>&1 || fail "jq is not installed"
command -v rclone >/dev/null 2>&1 || fail "rclone is not installed"
[[ -n "${BACKUP_DEST_REMOTE:-}" ]] || fail "BACKUP_DEST_REMOTE is not set"

max_age_hours="${MAX_BACKUP_AGE_HOURS:-30}"
latest_snapshot="$(
  rclone lsf "$BACKUP_DEST_REMOTE" --dirs-only \
    | tr -d '/' \
    | grep -E '^[0-9]{8}T[0-9]{6}Z$' \
    | sort \
    | tail -n 1
)"
[[ -n "$latest_snapshot" ]] || fail "No completed snapshot directory exists"

completion="$(rclone cat "${BACKUP_DEST_REMOTE%/}/${latest_snapshot}/COMPLETE.json")"
jq -e '.status == "complete"' <<<"$completion" >/dev/null \
  || fail "Latest snapshot has no valid completion marker"

snapshot_epoch="$(date -u -d "${latest_snapshot:0:8} ${latest_snapshot:9:2}:${latest_snapshot:11:2}:${latest_snapshot:13:2} UTC" +%s)"
now_epoch="$(date -u +%s)"
age_seconds=$((now_epoch - snapshot_epoch))
age_hours=$((age_seconds / 3600))
(( age_hours <= max_age_hours )) \
  || fail "Latest complete snapshot is ${age_hours} hours old"

jq -n \
  --arg status healthy \
  --arg snapshot_id "$latest_snapshot" \
  --argjson age_hours "$age_hours" \
  --argjson max_age_hours "$max_age_hours" \
  --argjson completion "$completion" \
  '{
    status: $status,
    snapshot_id: $snapshot_id,
    age_hours: $age_hours,
    max_age_hours: $max_age_hours,
    schema_version: $completion.schema_version,
    storage: $completion.storage,
    completed_at_utc: $completion.completed_at_utc
  }'
