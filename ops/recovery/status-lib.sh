#!/usr/bin/env bash

status_fail() {
  printf 'RECOVERY STATUS FAILED: %s\n' "$*" >&2
  exit 1
}

status_drop_dir() {
  if [[ "${STATUS_BRIDGE_TEST_MODE:-false}" == "true" ]]; then
    printf '%s\n' "${GUARDIAN_STATUS_DROP_DIR:?Test status drop is required}"
    return
  fi
  printf '%s\n' "/var/lib/scalesafe-backup-status"
}

status_guardian_group() {
  if [[ "${STATUS_BRIDGE_TEST_MODE:-false}" == "true" ]]; then
    printf '%s\n' "${GUARDIAN_STATUS_GROUP:?Test status group is required}"
    return
  fi
  printf '%s\n' "scalesafe-guardian-recovery"
}

restore_proof_dir() {
  if [[ "${STATUS_BRIDGE_TEST_MODE:-false}" == "true" ]]; then
    printf '%s\n' "${GUARDIAN_RESTORE_PROOF_DIR:?Test restore proof drop is required}"
    return
  fi
  printf '%s\n' "/var/lib/scalesafe-restore-proof"
}

assert_status_drop_boundary() {
  local directory owner_uid expected_group actual
  directory="$(status_drop_dir)"
  [[ -d "$directory" ]] || status_fail "Status drop directory is missing"
  owner_uid="$(stat -c '%u' "$directory")"
  expected_group="$(status_guardian_group)"
  actual="$(stat -c '%G:%a' "$directory")"
  [[ "$owner_uid" == "$(id -u)" ]] \
    || status_fail "Status drop directory has the wrong owner"
  [[ "$actual" == "${expected_group}:2750" ]] \
    || status_fail "Status drop directory has the wrong group or mode"
}

assert_restore_proof_boundary() {
  local directory owner_uid expected_group actual
  directory="$(restore_proof_dir)"
  [[ -d "$directory" ]] || status_fail "Restore proof directory is missing"
  owner_uid="$(stat -c '%u' "$directory")"
  expected_group="$(status_guardian_group)"
  actual="$(stat -c '%G:%a' "$directory")"
  if [[ "${STATUS_BRIDGE_TEST_MODE:-false}" == "true" ]]; then
    [[ "$owner_uid" == "$(id -u)" ]] \
      || status_fail "Test restore proof directory has the wrong owner"
  else
    [[ "$EUID" == "0" && "$owner_uid" == "0" ]] \
      || status_fail "Restore proof directory must be root-owned"
  fi
  [[ "$actual" == "${expected_group}:2750" ]] \
    || status_fail "Restore proof directory has the wrong group or mode"
}

write_hashed_status_document() {
  local target="$1"
  local unsigned_json="$2"
  local directory temporary canonical digest final
  directory="$(dirname "$target")"
  if [[ "$directory" == "$(status_drop_dir)" ]]; then
    assert_status_drop_boundary
  elif [[ "$directory" == "$(restore_proof_dir)" ]]; then
    assert_restore_proof_boundary
  else
    status_fail "Status target escaped the approved drop directories"
  fi

  canonical="$(jq -cS . <<<"$unsigned_json")" \
    || status_fail "Status document is not valid JSON"
  digest="$(printf '%s' "$canonical" | sha256sum | awk '{print $1}')"
  [[ "$digest" =~ ^[a-f0-9]{64}$ ]] \
    || status_fail "Status document hash failed"
  final="$(jq -cS --arg digest "$digest" \
    '. + {content_sha256: $digest}' <<<"$canonical")"
  (( ${#final} <= 65536 )) || status_fail "Status document is too large"

  temporary="$(mktemp "${directory}/.$(basename "$target").XXXXXX")"
  trap 'rm -f "${temporary:-}"' RETURN
  printf '%s\n' "$final" > "$temporary"
  chmod 0640 "$temporary"
  [[ "$(stat -c '%G:%a' "$temporary")" == \
    "$(status_guardian_group):640" ]] \
    || status_fail "Status file did not inherit the read-only Guardian group"
  jq -e \
    --arg digest "$digest" \
    'type == "object" and .content_sha256 == $digest' \
    "$temporary" >/dev/null \
    || status_fail "Status document failed final validation"
  sync -f "$temporary"
  mv -f "$temporary" "$target"
  sync -f "$directory"
  trap - RETURN
}
