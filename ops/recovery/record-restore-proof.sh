#!/usr/bin/env bash
set -Eeuo pipefail

umask 027
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT_ID="${1:-}"
SCHEMA_VERSION="${2:-}"
SCRATCH_TARGET_ID="${3:-}"
STARTED_AT="${4:-}"
COMPLETED_AT="${5:-}"
TESTER_ROLE="${6:-}"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/status-lib.sh"

[[ "${RESTORE_PROOF_CONFIRMATION:-}" == \
  "RESTORE_VERIFIED_AND_SCRATCH_ISOLATED" ]] \
  || status_fail "Restore proof confirmation is missing"
[[ "$SNAPSHOT_ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] \
  || status_fail "Snapshot ID is invalid"
[[ "$SCHEMA_VERSION" =~ ^[1-9][0-9]{0,9}$ ]] \
  || status_fail "Schema version is invalid"
[[ "$SCRATCH_TARGET_ID" =~ ^[A-Za-z0-9._:-]{8,128}$ ]] \
  || status_fail "Scratch target identifier is invalid"
[[ "$STARTED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || status_fail "Restore start time is invalid"
[[ "$COMPLETED_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
  || status_fail "Restore completion time is invalid"
[[ "$TESTER_ROLE" =~ ^(owner_operator|owner_with_assistant|authorized_operator)$ ]] \
  || status_fail "Tester role is invalid"

started_epoch="$(date -u -d "$STARTED_AT" +%s)"
completed_epoch="$(date -u -d "$COMPLETED_AT" +%s)"
now_epoch="$(date -u +%s)"
(( completed_epoch >= started_epoch )) \
  || status_fail "Restore completion precedes its start"
(( completed_epoch <= now_epoch + 300 )) \
  || status_fail "Restore completion is in the future"

scratch_hash="$(printf '%s' "$SCRATCH_TARGET_ID" | sha256sum | awk '{print $1}')"
unsigned="$(
  jq -n \
    --arg document_type scalesafe_restore_proof \
    --arg snapshot_id "$SNAPSHOT_ID" \
    --argjson source_schema_version "$SCHEMA_VERSION" \
    --arg scratch_target_sha256 "$scratch_hash" \
    --arg started_at_utc "$STARTED_AT" \
    --arg completed_at_utc "$COMPLETED_AT" \
    --arg tester_role "$TESTER_ROLE" \
    '{
      format_version: 1,
      document_type: $document_type,
      snapshot_id: $snapshot_id,
      source_schema_version: $source_schema_version,
      scratch_target_sha256: $scratch_target_sha256,
      started_at_utc: $started_at_utc,
      completed_at_utc: $completed_at_utc,
      critical_counts_verified: true,
      storage_inventory_verified: true,
      sample_files_verified: true,
      outbound_integrations_disabled: true,
      tester_role: $tester_role,
      result: "passed"
    }'
)"
write_hashed_status_document \
  "$(restore_proof_dir)/restore-proof.json" \
  "$unsigned"
printf 'RESTORE PROOF PUBLISHED: %s (schema %s)\n' \
  "$SNAPSHOT_ID" "$SCHEMA_VERSION"
