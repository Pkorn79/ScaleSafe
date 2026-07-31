#!/usr/bin/env bash
set -uo pipefail

umask 027
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-/etc/scalesafe-recovery/backup.env}"
attempt_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

"${SCRIPT_DIR}/backup.sh" "$ENV_FILE"
backup_rc=$?
if [[ $backup_rc -eq 0 ]]; then
  attempt_result=success
else
  attempt_result=failed
fi

"${SCRIPT_DIR}/publish-backup-status.sh" \
  "$ENV_FILE" "$attempt_result" "$attempt_at"
status_rc=$?

if [[ $backup_rc -ne 0 ]]; then
  exit "$backup_rc"
fi
exit "$status_rc"
