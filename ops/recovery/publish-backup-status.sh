#!/usr/bin/env bash
set -Eeuo pipefail

umask 027
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-/etc/scalesafe-recovery/backup.env}"
ATTEMPT_RESULT="${2:-observe}"
ATTEMPT_AT="${3:-}"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/status-lib.sh"

[[ "$ATTEMPT_RESULT" =~ ^(observe|success|failed)$ ]] \
  || status_fail "Attempt result must be observe, success, or failed"
if [[ "$ATTEMPT_RESULT" != "observe" ]]; then
  [[ "$ATTEMPT_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || status_fail "Attempt timestamp is invalid"
fi
[[ -r "$ENV_FILE" ]] || status_fail "Backup environment is unavailable"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for command_name in awk date flock jq rclone sha256sum stat sync systemctl; do
  command -v "$command_name" >/dev/null 2>&1 \
    || status_fail "Required status command is missing: ${command_name}"
done
[[ -n "${BACKUP_DEST_REMOTE:-}" ]] || status_fail "Backup destination is unavailable"

drop_dir="$(status_drop_dir)"
status_file="${drop_dir}/backup-status.json"
if [[ "${STATUS_BRIDGE_TEST_MODE:-false}" == "true" ]]; then
  lock_file="${BACKUP_STATUS_LOCK_FILE:?Test status lock is required}"
else
  lock_file="/var/lock/scalesafe-backup-status.lock"
fi
exec 8>"$lock_file"
flock -n 8 || status_fail "Another backup-status writer is running"

previous_attempt_result=unknown
previous_attempt_at_json=null
if [[ -r "$status_file" ]] \
  && jq -e '.document_type == "scalesafe_backup_status"' "$status_file" >/dev/null 2>&1; then
  previous_attempt_result="$(
    jq -r '.last_attempt_result // "unknown"' "$status_file"
  )"
  previous_attempt_at_json="$(jq -c '.last_attempt_at_utc' "$status_file")"
fi

if [[ "$ATTEMPT_RESULT" == "observe" ]]; then
  last_attempt_result="$previous_attempt_result"
  last_attempt_at_json="$previous_attempt_at_json"
  service_active="$(
    systemctl show scalesafe-backup.service \
      -p ActiveState --value 2>/dev/null || true
  )"
  service_result="$(
    systemctl show scalesafe-backup.service \
      -p Result --value 2>/dev/null || true
  )"
  service_exit_raw="$(
    systemctl show scalesafe-backup.service \
      -p ExecMainExitTimestamp --value 2>/dev/null || true
  )"
  service_exit_at="$(
    date -u -d "$service_exit_raw" +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true
  )"
  previous_attempt_at="$(
    jq -r 'if type == "string" then . else empty end' \
      <<<"$previous_attempt_at_json"
  )"
  if [[ "$service_active" != "active" && -n "$service_exit_at" ]]; then
    service_exit_epoch="$(date -u -d "$service_exit_at" +%s)"
    previous_attempt_epoch=0
    if [[ -n "$previous_attempt_at" ]]; then
      previous_attempt_epoch="$(
        date -u -d "$previous_attempt_at" +%s 2>/dev/null || printf '0'
      )"
    fi
    if (( service_exit_epoch >= previous_attempt_epoch )); then
      last_attempt_at_json="$(
        jq -Rn --arg value "$service_exit_at" '$value'
      )"
      if [[ "$service_result" == "success" ]]; then
        last_attempt_result=success
      elif [[ -n "$service_result" && "$service_result" != "n/a" ]]; then
        last_attempt_result=failed
      fi
    fi
  fi
else
  last_attempt_result="$ATTEMPT_RESULT"
  last_attempt_at_json="$(jq -Rn --arg value "$ATTEMPT_AT" '$value')"
fi

generated_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
verification_json=''
verification_rc=0
set +e
verification_json="$(
  "${SCRIPT_DIR}/verify-latest.sh" "$ENV_FILE" 2>/dev/null
)"
verification_rc=$?
set -e

snapshot_id_json=null
snapshot_age_json=null
max_age_json="${MAX_BACKUP_AGE_HOURS:-30}"
schema_version_json=null
storage_objects_json=null
storage_bytes_json=null
encrypted_bytes_json=null
completed_at_json=null
verified_at_json=null

if [[ $verification_rc -eq 0 ]] \
  && jq -e '
    .status == "healthy"
    and (.snapshot_id | type == "string")
    and (.age_hours | type == "number")
    and (.max_age_hours | type == "number")
    and (.schema_version | tostring | test("^[0-9]+$"))
    and (.storage.objects | type == "number")
    and (.storage.bytes | type == "number")
    and (.completed_at_utc | type == "string")
  ' <<<"$verification_json" >/dev/null 2>&1; then
  snapshot_id="$(jq -r '.snapshot_id' <<<"$verification_json")"
  encrypted_size_json=''
  encrypted_size_rc=0
  set +e
  encrypted_size_json="$(
    rclone size "${BACKUP_DEST_REMOTE%/}/${snapshot_id}" --json 2>/dev/null
  )"
  encrypted_size_rc=$?
  set -e
  if [[ $encrypted_size_rc -eq 0 ]] \
    && jq -e '.bytes | type == "number"' <<<"$encrypted_size_json" >/dev/null 2>&1; then
    snapshot_id_json="$(jq -Rn --arg value "$snapshot_id" '$value')"
    snapshot_age_json="$(jq -c '.age_hours' <<<"$verification_json")"
    max_age_json="$(jq -c '.max_age_hours' <<<"$verification_json")"
    schema_version_json="$(jq -c '.schema_version | tonumber' <<<"$verification_json")"
    storage_objects_json="$(jq -c '.storage.objects' <<<"$verification_json")"
    storage_bytes_json="$(jq -c '.storage.bytes' <<<"$verification_json")"
    encrypted_bytes_json="$(jq -c '.bytes' <<<"$encrypted_size_json")"
    completed_at_json="$(jq -c '.completed_at_utc' <<<"$verification_json")"
    verified_at_json="$(jq -Rn --arg value "$generated_at" '$value')"
  else
    verification_rc=1
  fi
else
  verification_rc=1
fi

timer_active_value="$(systemctl show scalesafe-backup.timer -p ActiveState --value 2>/dev/null || true)"
timer_enabled_value="$(systemctl show scalesafe-backup.timer -p UnitFileState --value 2>/dev/null || true)"
timer_last_value="$(systemctl show scalesafe-backup.timer -p LastTriggerUSec --value 2>/dev/null || true)"
timer_next_value="$(systemctl show scalesafe-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || true)"

timer_active=false
timer_enabled=false
[[ "$timer_active_value" == "active" ]] && timer_active=true
[[ "$timer_enabled_value" == "enabled" ]] && timer_enabled=true

date_or_null() {
  local value="$1"
  local converted
  [[ -n "$value" && "$value" != "n/a" ]] || {
    printf 'null\n'
    return
  }
  converted="$(date -u -d "$value" +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || true)"
  if [[ -n "$converted" ]]; then
    jq -Rn --arg value "$converted" '$value'
  else
    printf 'null\n'
  fi
}

timer_last_json="$(date_or_null "$timer_last_value")"
timer_next_json="$(date_or_null "$timer_next_value")"

status=healthy
error_code=NONE
if [[ $verification_rc -ne 0 ]]; then
  status=failed
  error_code=BACKUP_VERIFY_FAILED
elif [[ "$last_attempt_result" == "failed" ]]; then
  status=failed
  error_code=BACKUP_ATTEMPT_FAILED
elif [[ "$timer_active" != "true" || "$timer_enabled" != "true" ]]; then
  status=failed
  error_code=BACKUP_TIMER_DISABLED
fi

unsigned="$(
  jq -n \
    --arg document_type scalesafe_backup_status \
    --arg generated_at_utc "$generated_at" \
    --arg status "$status" \
    --argjson snapshot_id "$snapshot_id_json" \
    --argjson snapshot_age_hours "$snapshot_age_json" \
    --argjson max_age_hours "$max_age_json" \
    --argjson schema_version "$schema_version_json" \
    --argjson storage_object_count "$storage_objects_json" \
    --argjson storage_bytes "$storage_bytes_json" \
    --argjson encrypted_bytes "$encrypted_bytes_json" \
    --argjson completed_at_utc "$completed_at_json" \
    --argjson verified_at_utc "$verified_at_json" \
    --argjson timer_last_run_at_utc "$timer_last_json" \
    --argjson timer_next_run_at_utc "$timer_next_json" \
    --argjson timer_active "$timer_active" \
    --argjson timer_enabled "$timer_enabled" \
    --argjson last_attempt_at_utc "$last_attempt_at_json" \
    --arg last_attempt_result "$last_attempt_result" \
    --arg error_code "$error_code" \
    '{
      format_version: 1,
      document_type: $document_type,
      generated_at_utc: $generated_at_utc,
      status: $status,
      snapshot_id: $snapshot_id,
      snapshot_age_hours: $snapshot_age_hours,
      max_age_hours: $max_age_hours,
      schema_version: $schema_version,
      storage_object_count: $storage_object_count,
      storage_bytes: $storage_bytes,
      encrypted_bytes: $encrypted_bytes,
      completed_at_utc: $completed_at_utc,
      verified_at_utc: $verified_at_utc,
      timer_last_run_at_utc: $timer_last_run_at_utc,
      timer_next_run_at_utc: $timer_next_run_at_utc,
      timer_active: $timer_active,
      timer_enabled: $timer_enabled,
      last_attempt_at_utc: $last_attempt_at_utc,
      last_attempt_result: $last_attempt_result,
      error_code: $error_code
    }'
)"
write_hashed_status_document "$status_file" "$unsigned"
printf 'BACKUP STATUS PUBLISHED: %s\n' "$status"
[[ "$status" == "healthy" ]]
