#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf 'STATUS BRIDGE INSTALL REFUSED: %s\n' "$*" >&2
  exit 1
}

assert_unit_disabled_before_install() {
  local unit=$1
  local load_state
  local active_state
  local unit_file_state

  load_state="$(systemctl show "$unit" -p LoadState --value 2>/dev/null || true)"
  if [[ -z "$load_state" || "$load_state" == "not-found" ]]; then
    return
  fi

  active_state="$(
    systemctl show "$unit" -p ActiveState --value 2>/dev/null || true
  )"
  [[ "$active_state" == "inactive" || "$active_state" == "failed" ]] \
    || fail "$unit is currently ${active_state:-unknown}"

  unit_file_state="$(
    systemctl show "$unit" -p UnitFileState --value 2>/dev/null || true
  )"
  [[ "$unit_file_state" == "disabled" ]] \
    || fail "$unit must be disabled before installation; current state is ${unit_file_state:-unknown}"
}

[[ ${EUID} -eq 0 ]] || fail "run as root"
id scalesafe-backup >/dev/null 2>&1 || fail "scalesafe-backup is missing"
id scalesafe-guardian >/dev/null 2>&1 || fail "scalesafe-guardian is missing"
getent group scalesafe-guardian-recovery >/dev/null \
  || fail "scalesafe-guardian-recovery group is missing"
[[ -d /opt/scalesafe-recovery ]] || fail "recovery installation is missing"

systemctl is-active --quiet scalesafe-backup.service \
  && fail "backup service is currently running; wait for it to finish"
for unit in scalesafe-backup-status.service scalesafe-backup-status.timer; do
  assert_unit_disabled_before_install "$unit"
done

install \
  -d -o scalesafe-backup -g scalesafe-guardian-recovery -m 2750 \
  /var/lib/scalesafe-backup-status
install \
  -d -o root -g scalesafe-guardian-recovery -m 2750 \
  /var/lib/scalesafe-restore-proof
for script in \
  status-lib.sh \
  publish-backup-status.sh \
  run-backup-with-status.sh
do
  install \
    -o root -g scalesafe-backup -m 0750 \
    "${SOURCE_DIR}/${script}" \
    "/opt/scalesafe-recovery/${script}"
done
install \
  -o root -g root -m 0750 \
  "${SOURCE_DIR}/record-restore-proof.sh" \
  /opt/scalesafe-recovery/record-restore-proof.sh
install \
  -o root -g root -m 0750 \
  "${SOURCE_DIR}/audit-guardian-status-bridge-disabled.sh" \
  /opt/scalesafe-recovery/audit-guardian-status-bridge-disabled.sh
install \
  -o root -g root -m 0644 \
  "${SOURCE_DIR}/systemd/scalesafe-backup-status.service" \
  /etc/systemd/system/scalesafe-backup-status.service
install \
  -o root -g root -m 0644 \
  "${SOURCE_DIR}/systemd/scalesafe-backup-status.timer" \
  /etc/systemd/system/scalesafe-backup-status.timer
systemctl daemon-reload

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

printf '%s\n' \
  "DISABLED STATUS BRIDGE INSTALL COMPLETE" \
  "The active backup service and timer were not changed." \
  "No status service or timer was started or enabled."
