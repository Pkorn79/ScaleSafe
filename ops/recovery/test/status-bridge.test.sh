#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

recovery="${work}/recovery"
mock_bin="${work}/bin"
drop="${work}/drop"
restore_drop="${work}/restore-proof"
mkdir -p "$recovery" "$mock_bin" "$drop" "$restore_drop"
chmod 2750 "$drop"
chmod 2750 "$restore_drop"

cp \
  "$SOURCE_DIR/status-lib.sh" \
  "$SOURCE_DIR/publish-backup-status.sh" \
  "$SOURCE_DIR/run-backup-with-status.sh" \
  "$SOURCE_DIR/verify-latest.sh" \
  "$recovery/"
chmod u+x "$recovery"/*.sh

cat > "${mock_bin}/systemctl" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *scalesafe-backup.service*ActiveState*)
    printf '%s\n' "${MOCK_SERVICE_ACTIVE:-inactive}"
    ;;
  *scalesafe-backup.service*Result*)
    printf '%s\n' "${MOCK_SERVICE_RESULT:-success}"
    ;;
  *scalesafe-backup.service*ExecMainExitTimestamp*)
    printf '%s\n' "${MOCK_SERVICE_EXIT:-Thu 2026-07-30 03:21:03 UTC}"
    ;;
  *scalesafe-backup.timer*ActiveState*) printf 'active\n' ;;
  *scalesafe-backup.timer*UnitFileState*) printf 'enabled\n' ;;
  *scalesafe-backup.timer*LastTriggerUSec*)
    printf 'Thu 2026-07-30 03:21:03 UTC\n'
    ;;
  *scalesafe-backup.timer*NextElapseUSecRealtime*)
    printf 'Fri 2026-07-31 03:20:25 UTC\n'
    ;;
  *) exit 1 ;;
esac
EOF

cat > "${mock_bin}/rclone" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  lsf)
    printf '%s/\n' "${MOCK_SNAPSHOT_ID}"
    ;;
  cat)
    cat <<JSON
{
  "status": "complete",
  "snapshot_id": "${MOCK_SNAPSHOT_ID}",
  "completed_at_utc": "${MOCK_COMPLETED_AT}",
  "project_ref": "must-not-leak",
  "schema_version": "105",
  "storage": {"objects": 105, "bytes": 21011034},
  "sha256": {
    "database_and_metadata": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "storage_objects": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  }
}
JSON
    ;;
  size)
    printf '{"count":4,"bytes":12000000}\n'
    ;;
  *)
    exit 1
    ;;
esac
EOF
chmod u+x "${mock_bin}/systemctl" "${mock_bin}/rclone"

cat > "${recovery}/backup.sh" <<'EOF'
#!/usr/bin/env bash
exit "${MOCK_BACKUP_EXIT:-0}"
EOF
chmod u+x "${recovery}/backup.sh"

cat > "${work}/backup.env" <<EOF
BACKUP_DEST_REMOTE=mock:recovery
MAX_BACKUP_AGE_HOURS=30
EOF
chmod 0600 "${work}/backup.env"

export PATH="${mock_bin}:${PATH}"
export STATUS_BRIDGE_TEST_MODE=true
export GUARDIAN_STATUS_DROP_DIR="$drop"
export GUARDIAN_RESTORE_PROOF_DIR="$restore_drop"
export GUARDIAN_STATUS_GROUP
GUARDIAN_STATUS_GROUP="$(id -gn)"
export BACKUP_STATUS_LOCK_FILE="${work}/status.lock"
export MOCK_SNAPSHOT_ID
export MOCK_COMPLETED_AT
MOCK_SNAPSHOT_ID="$(date -u -d '2 hours ago' +'%Y%m%dT%H%M%SZ')"
MOCK_COMPLETED_AT="$(date -u -d '2 hours ago' +'%Y-%m-%dT%H:%M:%SZ')"

bridge_installer="${SOURCE_DIR}/install-guardian-status-bridge-disabled.sh"
grep -F '[[ "$unit_file_state" == "disabled" ]]' \
  "$bridge_installer" >/dev/null
preflight_line="$(
  grep -nF 'assert_unit_disabled_before_install "$unit"' \
    "$bridge_installer" |
    tail -n 1 |
    cut -d: -f1
)"
first_install_line="$(
  grep -n '^install ' "$bridge_installer" |
    head -n 1 |
    cut -d: -f1
)"
[[ -n "$preflight_line" && -n "$first_install_line" ]]
(( preflight_line < first_install_line ))

"${recovery}/run-backup-with-status.sh" "${work}/backup.env" >/dev/null
status_file="${drop}/backup-status.json"
jq -e '
  .document_type == "scalesafe_backup_status"
  and .status == "healthy"
  and .last_attempt_result == "success"
  and .timer_active
  and .timer_enabled
  and .storage_object_count == 105
  and .encrypted_bytes == 12000000
  and .error_code == "NONE"
  and (has("project_ref") | not)
  and (has("bucket") | not)
  and (has("remote") | not)
' "$status_file" >/dev/null
canonical="$(jq -cS 'del(.content_sha256)' "$status_file")"
expected_hash="$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')"
[[ "$(jq -r '.content_sha256' "$status_file")" == "$expected_hash" ]]
[[ "$(stat -c '%a' "$status_file")" == "640" ]]

cp "${recovery}/verify-latest.sh" "${work}/verify-latest.original.sh"
cat > "${recovery}/verify-latest.sh" <<'EOF'
#!/usr/bin/env bash
printf '{"status":"rejected"}\n'
EOF
chmod u+x "${recovery}/verify-latest.sh"
set +e
"${recovery}/publish-backup-status.sh" \
  "${work}/backup.env" success "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" >/dev/null
rejected_rc=$?
set -e
[[ $rejected_rc -ne 0 ]]
jq -e '
  .status == "failed"
  and .error_code == "BACKUP_VERIFY_FAILED"
  and .snapshot_id == null
' "$status_file" >/dev/null
mv "${work}/verify-latest.original.sh" "${recovery}/verify-latest.sh"
chmod u+x "${recovery}/verify-latest.sh"

export MOCK_SERVICE_ACTIVE=failed
export MOCK_SERVICE_RESULT=timeout
export MOCK_SERVICE_EXIT
MOCK_SERVICE_EXIT="$(date -u +'%a %Y-%m-%d %H:%M:%S UTC')"
set +e
"${recovery}/publish-backup-status.sh" \
  "${work}/backup.env" observe >/dev/null
failed_service_rc=$?
set -e
[[ $failed_service_rc -ne 0 ]]
jq -e '
  .status == "failed"
  and .last_attempt_result == "failed"
  and .error_code == "BACKUP_ATTEMPT_FAILED"
' "$status_file" >/dev/null
unset MOCK_SERVICE_ACTIVE MOCK_SERVICE_RESULT MOCK_SERVICE_EXIT

export MOCK_BACKUP_EXIT=7
set +e
"${recovery}/run-backup-with-status.sh" "${work}/backup.env" >/dev/null
backup_rc=$?
set -e
[[ $backup_rc -eq 7 ]]
jq -e '
  .status == "failed"
  and .last_attempt_result == "failed"
  and .error_code == "BACKUP_ATTEMPT_FAILED"
' "$status_file" >/dev/null
unset MOCK_BACKUP_EXIT

export RESTORE_PROOF_CONFIRMATION=RESTORE_VERIFIED_AND_SCRATCH_ISOLATED
bash "${SOURCE_DIR}/record-restore-proof.sh" \
  "$MOCK_SNAPSHOT_ID" \
  105 \
  scratch-project-test-only \
  "$(date -u -d '30 minutes ago' +'%Y-%m-%dT%H:%M:%SZ')" \
  "$(date -u -d '5 minutes ago' +'%Y-%m-%dT%H:%M:%SZ')" \
  owner_with_assistant >/dev/null
proof_file="${restore_drop}/restore-proof.json"
jq -e '
  .document_type == "scalesafe_restore_proof"
  and .result == "passed"
  and .critical_counts_verified
  and .storage_inventory_verified
  and .sample_files_verified
  and .outbound_integrations_disabled
  and (.scratch_target_sha256 | test("^[a-f0-9]{64}$"))
  and (tostring | contains("scratch-project-test-only") | not)
' "$proof_file" >/dev/null

printf 'RECOVERY STATUS BRIDGE TEST PASSED\n'
