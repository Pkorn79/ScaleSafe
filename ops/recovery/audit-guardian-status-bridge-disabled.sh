#!/usr/bin/env bash
set -Eeuo pipefail

[[ ${EUID} -eq 0 ]] || {
  echo "Run this audit with sudo." >&2
  exit 1
}

fail() {
  echo "STATUS BRIDGE AUDIT FAILED: $*" >&2
  exit 1
}

[[ $(stat -c '%U:%G:%a' /var/lib/scalesafe-backup-status) \
  == "scalesafe-backup:scalesafe-guardian-recovery:2750" ]] \
  || fail "status drop ownership or mode is wrong"
[[ $(stat -c '%U:%G:%a' /var/lib/scalesafe-restore-proof) \
  == "root:scalesafe-guardian-recovery:2750" ]] \
  || fail "restore-proof drop ownership or mode is wrong"
[[ $(stat -c '%U:%G:%a' \
  /opt/scalesafe-recovery/record-restore-proof.sh) == "root:root:750" ]] \
  || fail "restore-proof recorder is not owner-controlled"
runuser -u scalesafe-backup -- test -w /var/lib/scalesafe-backup-status \
  || fail "backup service cannot write the status drop"
if runuser -u scalesafe-backup -- test -r /var/lib/scalesafe-restore-proof \
  || runuser -u scalesafe-backup -- test -w /var/lib/scalesafe-restore-proof; then
  fail "backup service can access the owner restore-proof drop"
fi
runuser -u scalesafe-guardian -- test -r /var/lib/scalesafe-backup-status \
  || fail "Guardian cannot read the status drop"
runuser -u scalesafe-guardian -- test -r /var/lib/scalesafe-restore-proof \
  || fail "Guardian cannot read the restore-proof drop"
if runuser -u scalesafe-guardian -- test -w /var/lib/scalesafe-backup-status; then
  fail "Guardian can write the status drop"
fi
if runuser -u scalesafe-guardian -- test -w /var/lib/scalesafe-restore-proof; then
  fail "Guardian can write the restore-proof drop"
fi
if [[ -e /var/lib/scalesafe-restore-proof/restore-proof.json ]]; then
  [[ $(stat -c '%U:%G:%a' \
    /var/lib/scalesafe-restore-proof/restore-proof.json) \
    == "root:scalesafe-guardian-recovery:640" ]] \
    || fail "restore proof ownership or mode is wrong"
fi
if runuser -u scalesafe-openclaw -- test -r /var/lib/scalesafe-backup-status \
  || runuser -u scalesafe-openclaw -- test -w /var/lib/scalesafe-backup-status; then
  fail "OpenClaw can access the status drop"
fi
if runuser -u scalesafe-openclaw -- test -r /var/lib/scalesafe-restore-proof \
  || runuser -u scalesafe-openclaw -- test -w /var/lib/scalesafe-restore-proof; then
  fail "OpenClaw can access the restore-proof drop"
fi

for forbidden in \
  /etc/scalesafe-recovery \
  /home/scalesafe-backup \
  /opt/scalesafe-recovery \
  /var/lib/scalesafe-recovery \
  /var/lib/scalesafe-restore \
  /run/docker.sock \
  /var/run/docker.sock
do
  if runuser -u scalesafe-guardian -- test -r "$forbidden" \
    || runuser -u scalesafe-guardian -- test -w "$forbidden"; then
    fail "Guardian can access forbidden path ${forbidden}"
  fi
done

[[ $(systemctl show scalesafe-backup.timer -p ActiveState --value) == "active" ]] \
  || fail "production backup timer is not active"
[[ $(systemctl show scalesafe-backup.timer -p UnitFileState --value) == "enabled" ]] \
  || fail "production backup timer is not enabled"
systemctl cat scalesafe-backup.service \
  | grep -F 'ExecStart=/opt/scalesafe-recovery/backup.sh' >/dev/null \
  || fail "active backup service changed during disabled installation"
[[ $(systemctl show scalesafe-backup-status.service \
  -p ActiveState --value) == "inactive" ]] \
  || fail "status service is active"
[[ $(systemctl show scalesafe-backup-status.timer \
  -p ActiveState --value) == "inactive" ]] \
  || fail "status timer is active"
[[ $(systemctl show scalesafe-backup-status.timer \
  -p UnitFileState --value) == "disabled" ]] \
  || fail "status timer is enabled"
[[ $(systemctl show scalesafe-backup-status.service \
  -p UnitFileState --value) == "disabled" ]] \
  || fail "status service is enabled"

echo "DISABLED STATUS BRIDGE AUDIT PASSED"
echo "The active backup service and timer remain unchanged."
