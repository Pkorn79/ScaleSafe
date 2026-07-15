#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-/etc/scalesafe-recovery/backup.env}"

fail() {
  printf 'BACKUP FAILED: %s\n' "$*" >&2
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
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

for name in \
  SUPABASE_PROJECT_REF \
  SUPABASE_DB_URL \
  SUPABASE_STORAGE_ENDPOINT \
  SUPABASE_STORAGE_REGION \
  SUPABASE_STORAGE_ACCESS_KEY_ID \
  SUPABASE_STORAGE_SECRET_ACCESS_KEY \
  BACKUP_DEST_REMOTE \
  BACKUP_AGE_RECIPIENT; do
  require_env "$name"
done

[[ "${BACKUP_DESTINATION_CONFIRMED_IMMUTABLE:-false}" == "true" ]] \
  || fail "Destination immutability has not been confirmed"
[[ "$BACKUP_AGE_RECIPIENT" == age1* ]] \
  || fail "BACKUP_AGE_RECIPIENT is not a valid age public recipient"

for command_name in age awk df diff docker flock jq psql rclone sed sha256sum sort supabase tar; do
  require_command "$command_name"
done

docker info >/dev/null 2>&1 || fail "Docker is not running; Supabase CLI database dumps require it"

BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/var/lib/scalesafe-recovery}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/scalesafe-backup.lock}"
BACKUP_MAX_LOCAL_GB="${BACKUP_MAX_LOCAL_GB:-25}"
VERIFY_OFFSITE_DOWNLOAD="${VERIFY_OFFSITE_DOWNLOAD:-true}"

mkdir -p "$BACKUP_WORK_DIR" "$(dirname "$BACKUP_LOCK_FILE")"
chmod 700 "$BACKUP_WORK_DIR"

exec 9>"$BACKUP_LOCK_FILE"
flock -n 9 || fail "Another backup is already running"

snapshot_id="$(date -u +'%Y%m%dT%H%M%SZ')"
run_dir="$(mktemp -d "${BACKUP_WORK_DIR}/.backup-${snapshot_id}.XXXXXX")"
control_dir="${run_dir}/control"
storage_dir="${run_dir}/storage"
upload_dir="${run_dir}/upload"
destination_root="${BACKUP_DEST_REMOTE%/}/${snapshot_id}"
mkdir -p "$control_dir" "$storage_dir" "$upload_dir"

cleanup() {
  local status=$?
  rm -rf "$run_dir"
  if [[ $status -ne 0 ]]; then
    printf 'BACKUP FAILED: snapshot %s did not receive a completion marker\n' "$snapshot_id" >&2
  fi
}
trap cleanup EXIT

export RCLONE_CONFIG_SUPABASE_SOURCE_TYPE=s3
export RCLONE_CONFIG_SUPABASE_SOURCE_PROVIDER=Other
export RCLONE_CONFIG_SUPABASE_SOURCE_ACCESS_KEY_ID="$SUPABASE_STORAGE_ACCESS_KEY_ID"
export RCLONE_CONFIG_SUPABASE_SOURCE_SECRET_ACCESS_KEY="$SUPABASE_STORAGE_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_SUPABASE_SOURCE_ENDPOINT="$SUPABASE_STORAGE_ENDPOINT"
export RCLONE_CONFIG_SUPABASE_SOURCE_REGION="$SUPABASE_STORAGE_REGION"
export RCLONE_CONFIG_SUPABASE_SOURCE_FORCE_PATH_STYLE=true

printf 'Backup %s: checking source and destination access\n' "$snapshot_id"
rclone lsd supabase_source: >/dev/null
rclone lsd "$BACKUP_DEST_REMOTE" >/dev/null

storage_size_json="$(rclone size supabase_source: --json)"
storage_bytes="$(jq -r '.bytes // 0' <<<"$storage_size_json")"
storage_objects="$(jq -r '.count // 0' <<<"$storage_size_json")"
max_local_bytes=$((BACKUP_MAX_LOCAL_GB * 1024 * 1024 * 1024))
required_local_bytes=$((storage_bytes * 2 + 2 * 1024 * 1024 * 1024))
available_local_bytes="$(df --output=avail -B1 "$BACKUP_WORK_DIR" | tail -n 1 | tr -d ' ')"

(( storage_bytes <= max_local_bytes )) \
  || fail "Storage is larger than BACKUP_MAX_LOCAL_GB; upgrade the backup design before continuing"
(( available_local_bytes >= required_local_bytes )) \
  || fail "Insufficient protected staging space for a complete Storage archive"

printf 'Backup %s: exporting database\n' "$snapshot_id"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "${control_dir}/roles.sql" --role-only
supabase db dump --db-url "$SUPABASE_DB_URL" -f "${control_dir}/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "${control_dir}/data.sql" \
  --use-copy --data-only \
  -x "storage.buckets_vectors" \
  -x "storage.vector_indexes"
supabase db dump --db-url "$SUPABASE_DB_URL" -f "${control_dir}/history_schema.sql" \
  --schema supabase_migrations
supabase db dump --db-url "$SUPABASE_DB_URL" -f "${control_dir}/history_data.sql" \
  --use-copy --data-only --schema supabase_migrations

psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -At \
  -f "${SCRIPT_DIR}/critical-counts.sql" > "${control_dir}/critical-counts.json"
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -At \
  -f "${SCRIPT_DIR}/storage-buckets.sql" > "${control_dir}/storage-buckets.json"

schema_version="$(jq -r '.schema_version' "${control_dir}/critical-counts.json")"
jq -n \
  --arg snapshot_id "$snapshot_id" \
  --arg project_ref "$SUPABASE_PROJECT_REF" \
  --arg schema_version "$schema_version" \
  --arg app_git_sha "${APP_GIT_SHA:-unknown}" \
  --arg supabase_cli_version "$(supabase --version)" \
  --argjson storage_objects "$storage_objects" \
  --argjson storage_bytes "$storage_bytes" \
  '{
    snapshot_id: $snapshot_id,
    captured_at_utc: ($snapshot_id | strptime("%Y%m%dT%H%M%SZ") | strftime("%Y-%m-%dT%H:%M:%SZ")),
    project_ref: $project_ref,
    schema_version: $schema_version,
    app_git_sha: $app_git_sha,
    supabase_cli_version: $supabase_cli_version,
    storage: { objects: $storage_objects, bytes: $storage_bytes }
  }' > "${control_dir}/backup-context.json"

printf 'Backup %s: downloading private Storage objects\n' "$snapshot_id"
mapfile -t storage_buckets < <(
  rclone lsf supabase_source: --dirs-only | sed 's:/$::' | sort
)
for bucket in "${storage_buckets[@]}"; do
  [[ -n "$bucket" ]] || continue
  mkdir -p "${storage_dir}/${bucket}"
  rclone copy "supabase_source:${bucket}" "${storage_dir}/${bucket}" \
    --fast-list \
    --transfers 4 \
    --checkers 8 \
    --timeout 30m \
    --stats-one-line \
    --stats 60s
done

rclone lsf supabase_source: --recursive --files-only --format sp --separator $'\t' \
  | sort > "${control_dir}/storage-source-inventory.tsv"
rclone lsf "$storage_dir" --recursive --files-only --format sp --separator $'\t' \
  | sort > "${control_dir}/storage-local-inventory.tsv"
diff -u "${control_dir}/storage-source-inventory.tsv" "${control_dir}/storage-local-inventory.tsv" >/dev/null \
  || fail "Storage inventory changed or did not copy completely"

printf 'Backup %s: encrypting archives\n' "$snapshot_id"
tar -C "$control_dir" -czf - . \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "${upload_dir}/database-and-metadata.tar.gz.age"
tar -C "$storage_dir" -czf - . \
  | age -r "$BACKUP_AGE_RECIPIENT" -o "${upload_dir}/storage-objects.tar.gz.age"

rm -rf "$control_dir" "$storage_dir"
(
  cd "$upload_dir"
  sha256sum database-and-metadata.tar.gz.age storage-objects.tar.gz.age > manifest.sha256
)

printf 'Backup %s: uploading encrypted snapshot\n' "$snapshot_id"
rclone copy "$upload_dir" "$destination_root" --immutable --transfers 2 --checkers 4

if [[ "$VERIFY_OFFSITE_DOWNLOAD" == "true" ]]; then
  rclone check "$upload_dir" "$destination_root" --download
fi

database_sha256="$(sha256sum "${upload_dir}/database-and-metadata.tar.gz.age" | awk '{print $1}')"
storage_sha256="$(sha256sum "${upload_dir}/storage-objects.tar.gz.age" | awk '{print $1}')"
completion_file="${run_dir}/COMPLETE.json"
jq -n \
  --arg snapshot_id "$snapshot_id" \
  --arg completed_at "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg project_ref "$SUPABASE_PROJECT_REF" \
  --arg schema_version "$schema_version" \
  --arg database_sha256 "$database_sha256" \
  --arg storage_sha256 "$storage_sha256" \
  --argjson storage_objects "$storage_objects" \
  --argjson storage_bytes "$storage_bytes" \
  '{
    status: "complete",
    snapshot_id: $snapshot_id,
    completed_at_utc: $completed_at,
    project_ref: $project_ref,
    schema_version: $schema_version,
    storage: { objects: $storage_objects, bytes: $storage_bytes },
    sha256: {
      database_and_metadata: $database_sha256,
      storage_objects: $storage_sha256
    }
  }' > "$completion_file"

# A snapshot is valid only after every archive verifies and this marker is written.
rclone copyto "$completion_file" "${destination_root}/COMPLETE.json" --immutable
rclone cat "${destination_root}/COMPLETE.json" | jq -e '.status == "complete"' >/dev/null

printf 'BACKUP COMPLETE: %s (schema %s, %s Storage objects)\n' \
  "$snapshot_id" "$schema_version" "$storage_objects"
