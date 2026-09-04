#!/usr/bin/env bash
set -euo pipefail

# ISOLATED DATABASE ONLY.
# Usage:
#   ./scripts/verify-command-center-phase2-behavior.sh \
#     postgresql://postgres:postgres@127.0.0.1:54322/postgres

DB_URL="${1:-}"
if [[ -z "$DB_URL" ]]; then
  echo "Provide the isolated database URL." >&2
  exit 2
fi

if [[ "$DB_URL" != *"@127.0.0.1:"* && "$DB_URL" != *"@localhost:"* ]]; then
  echo "Refusing to run against a non-loopback database." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql "$DB_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f "${SCRIPT_DIR}/verify-command-center-phase2-behavior.sql"

echo "BEHAVIOR VERIFIED: tenant binding, incident lifecycle, scheduler fault containment, timeout recovery, worker recovery, suppression expiry, escalation, sweep checkpoints, pagination, live operator authorization, provider grouping, and immutable history"
