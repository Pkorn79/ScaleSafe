#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-/etc/scalesafe-recovery/restore.env}"
SNAPSHOT_ID="${2:-}"

fail() {
  printf 'RESTORE FAILED: %s\n' "$*" >&2
  exit 1
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "Missing required setting: ${name}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command is not installed: $1"
}

[[ -r "$ENV_FILE" ]] || fail "Cannot read environment file: $ENV_FILE"
[[ "$SNAPSHOT_ID" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] \
  || fail "Pass one explicit snapshot ID in YYYYMMDDTHHMMSSZ format"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in \
  BACKUP_DEST_REMOTE \
  AGE_IDENTITY_FILE \
  PRODUCTION_PROJECT_REF \
  RESTORE_TARGET_PROJECT_REF \
  RESTORE_TARGET_DB_URL \
  RESTORE_TARGET_STORAGE_ENDPOINT \
  RESTORE_TARGET_STORAGE_REGION \
  RESTORE_TARGET_STORAGE_ACCESS_KEY_ID \
  RESTORE_TARGET_STORAGE_SECRET_ACCESS_KEY; do
  require_env "$name"
done

[[ "${RESTORE_CONFIRMATION:-}" == "RESTORE_TO_SCRATCH_ONLY" ]] \
  || fail "RESTORE_CONFIRMATION must equal RESTORE_TO_SCRATCH_ONLY"
[[ "$RESTORE_TARGET_PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ]] \
  || fail "The restore target is the production project"
[[ "$RESTORE_TARGET_DB_URL" != *"$PRODUCTION_PROJECT_REF"* ]] \
  || fail "The restore database URL contains the production project reference"
[[ -r "$AGE_IDENTITY_FILE" ]] || fail "Cannot read the offline age identity"

for command_name in age cmp diff grep jq psql rclone sed sha256sum sort tar; do
  require_command "$command_name"
done

RESTORE_WORK_DIR="${RESTORE_WORK_DIR:-/var/lib/scalesafe-restore}"
mkdir -p "$RESTORE_WORK_DIR"
chmod 700 "$RESTORE_WORK_DIR"
run_dir="$(mktemp -d "${RESTORE_WORK_DIR}/.restore-${SNAPSHOT_ID}.XXXXXX")"
download_dir="${run_dir}/download"
database_dir="${run_dir}/database"
storage_dir="${run_dir}/storage"
mkdir -p "$download_dir" "$database_dir" "$storage_dir"

cleanup() {
  rm -rf "$run_dir"
}
trap cleanup EXIT

snapshot_root="${BACKUP_DEST_REMOTE%/}/${SNAPSHOT_ID}"
printf 'Restore %s: downloading encrypted snapshot\n' "$SNAPSHOT_ID"
rclone copy "$snapshot_root" "$download_dir" --immutable

[[ -f "${download_dir}/COMPLETE.json" ]] || fail "Snapshot has no completion marker"
jq -e '.status == "complete" and .snapshot_id == $snapshot' \
  --arg snapshot "$SNAPSHOT_ID" "${download_dir}/COMPLETE.json" >/dev/null \
  || fail "Completion marker does not match the requested snapshot"
source_project_ref="$(jq -r '.project_ref' "${download_dir}/COMPLETE.json")"
[[ "$source_project_ref" == "$PRODUCTION_PROJECT_REF" ]] \
  || fail "Snapshot project reference does not match the declared production project"

(
  cd "$download_dir"
  sha256sum -c manifest.sha256
)

printf 'Restore %s: decrypting archives\n' "$SNAPSHOT_ID"
age --decrypt -i "$AGE_IDENTITY_FILE" "${download_dir}/database-and-metadata.tar.gz.age" \
  | tar -xzf - -C "$database_dir"
age --decrypt -i "$AGE_IDENTITY_FILE" "${download_dir}/storage-objects.tar.gz.age" \
  | tar -xzf - -C "$storage_dir"

source_schema_version="$(jq -r '.schema_version' "${database_dir}/critical-counts.json")"
completion_schema_version="$(jq -r '.schema_version' "${download_dir}/COMPLETE.json")"
[[ "$source_schema_version" == "$completion_schema_version" ]] \
  || fail "Encrypted metadata and completion marker disagree on schema version"

target_has_scalesafe="$(
  psql "$RESTORE_TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -Atc \
    "SELECT to_regclass('public.merchants') IS NOT NULL;"
)"
[[ "$target_has_scalesafe" == "f" ]] \
  || fail "Scratch target is not blank; create a new isolated project"

printf 'Restore %s: restoring database into scratch project %s\n' \
  "$SNAPSHOT_ID" "$RESTORE_TARGET_PROJECT_REF"
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "${database_dir}/roles.sql" \
  --file "${database_dir}/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "${database_dir}/data.sql" \
  --dbname "$RESTORE_TARGET_DB_URL"

psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "${database_dir}/history_schema.sql" \
  --file "${database_dir}/history_data.sql" \
  --dbname "$RESTORE_TARGET_DB_URL"

psql "$RESTORE_TARGET_DB_URL" -X -v ON_ERROR_STOP=1 -At \
  -f "${SCRIPT_DIR}/critical-counts.sql" > "${run_dir}/restored-critical-counts.json"

jq -S '{schema_version, tables}' "${database_dir}/critical-counts.json" \
  > "${run_dir}/source-counts.normalized.json"
jq -S '{schema_version, tables}' "${run_dir}/restored-critical-counts.json" \
  > "${run_dir}/target-counts.normalized.json"
cmp "${run_dir}/source-counts.normalized.json" "${run_dir}/target-counts.normalized.json" \
  || fail "Critical database counts differ after restore"

export RCLONE_CONFIG_SUPABASE_RESTORE_TYPE=s3
export RCLONE_CONFIG_SUPABASE_RESTORE_PROVIDER=Other
export RCLONE_CONFIG_SUPABASE_RESTORE_ACCESS_KEY_ID="$RESTORE_TARGET_STORAGE_ACCESS_KEY_ID"
export RCLONE_CONFIG_SUPABASE_RESTORE_SECRET_ACCESS_KEY="$RESTORE_TARGET_STORAGE_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SUPABASE_RESTORE_ENDPOINT="$RESTORE_TARGET_STORAGE_ENDPOINT"
export RCLONE_CONFIG_SUPABASE_RESTORE_REGION="$RESTORE_TARGET_STORAGE_REGION"
export RCLONE_CONFIG_SUPABASE_RESTORE_FORCE_PATH_STYLE=true

rclone lsd supabase_restore: >/dev/null \
  || fail "Scratch Storage is unavailable or its buckets were not restored"

printf 'Restore %s: restoring private Storage objects\n' "$SNAPSHOT_ID"
mapfile -t expected_buckets < <(jq -r '.[].id' "${database_dir}/storage-buckets.json" | sort)
mapfile -t restored_buckets < <(rclone lsf supabase_restore: --dirs-only | sed 's:/$::' | sort)
for bucket in "${expected_buckets[@]}"; do
  printf '%s\n' "${restored_buckets[@]}" | grep -Fx "$bucket" >/dev/null \
    || fail "Scratch database did not restore Storage bucket: $bucket"
  rclone copy "${storage_dir}/${bucket}" "supabase_restore:${bucket}" \
    --ignore-times \
    --transfers 4 \
    --checkers 8 \
    --timeout 30m \
    --stats-one-line \
    --stats 60s
  rclone check "${storage_dir}/${bucket}" "supabase_restore:${bucket}" --download
done

rclone lsf supabase_restore: --recursive --files-only --format sp --separator $'\t' \
  | sort > "${run_dir}/storage-restored-inventory.tsv"
diff -u "${database_dir}/storage-source-inventory.tsv" "${run_dir}/storage-restored-inventory.tsv" >/dev/null \
  || fail "Restored Storage inventory differs from the source snapshot"

printf 'RESTORE VERIFIED: %s into scratch project %s (schema %s)\n' \
  "$SNAPSHOT_ID" "$RESTORE_TARGET_PROJECT_REF" "$source_schema_version"
printf 'Keep the scratch project isolated. Perform the manual application checks, record proof, then delete it.\n'
