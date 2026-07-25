#!/usr/bin/env bash
set -euo pipefail

# ISOLATED VPS USE ONLY.
# Starts the Phase 2 application against a local Supabase CLI stack. The script
# refuses non-loopback Supabase URLs.

SUPABASE_DIR="${1:-}"
APP_DIR="${2:-}"
PORT="${3:-3104}"

if [[ -z "$SUPABASE_DIR" || -z "$APP_DIR" ]]; then
  echo "Usage: $0 <supabase-workspace> <application-build> [port]" >&2
  exit 2
fi

if [[ ! -d "$SUPABASE_DIR" || ! -f "$APP_DIR/dist/index.js" ]]; then
  echo "Supabase workspace or application build is missing." >&2
  exit 2
fi

if [[ -f "$APP_DIR/soak.pid" ]]; then
  EXISTING_PID="$(cat "$APP_DIR/soak.pid")"
  if kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "The isolated soak is already running as PID ${EXISTING_PID}." >&2
    exit 1
  fi
fi

SUPABASE_ENV="$(cd "$SUPABASE_DIR" && supabase status -o env 2>/dev/null)"
eval "$SUPABASE_ENV"

if [[ "${API_URL:-}" != http://127.0.0.1:* || -z "${SERVICE_ROLE_KEY:-}" || -z "${ANON_KEY:-}" ]]; then
  echo "Refusing to start: Supabase is not the isolated loopback stack." >&2
  exit 1
fi

export NODE_ENV=production
export PORT
export APP_URL="http://127.0.0.1:${PORT}"
export GHL_APP_CLIENT_ID="phase2-isolated-client"
export GHL_APP_CLIENT_SECRET="phase2-isolated-secret"
export GHL_APP_SSO_KEY="phase2-isolated-sso-key"
export SUPABASE_URL="$API_URL"
export SUPABASE_SERVICE_KEY="$SERVICE_ROLE_KEY"
export SUPABASE_ANON_KEY="$ANON_KEY"
export PROCESSOR_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
export PUBLIC_ACTION_TOKEN_SECRET="phase2-isolated-public-action-secret"
export OPERATOR_COMMAND_CENTER_ENABLED=true
export OPERATOR_HEALTH_INCIDENTS_ENABLED=true
export OPERATOR_AUTH_ENABLED=true
export OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY="1111111111111111111111111111111111111111111111111111111111111111"
export OPERATOR_HOST="ops.phase2.local"
export OPERATOR_TRUST_PROXY_HOPS=1
export LOG_LEVEL=info

cd "$APP_DIR"
date -u +%Y-%m-%dT%H:%M:%SZ > soak-started-at.txt
printf '%s\n' "$PORT" > soak-port.txt
nohup node dist/index.js > soak.log 2>&1 &
SOAK_PID=$!
echo "$SOAK_PID" > soak.pid

sleep 3
if ! kill -0 "$SOAK_PID" 2>/dev/null; then
  echo "The isolated application exited during startup." >&2
  tail -100 soak.log >&2
  exit 1
fi

curl --fail --silent --show-error "http://127.0.0.1:${PORT}/health" >/dev/null
echo "SOAK STARTED: PID ${SOAK_PID}, port ${PORT}, isolated Supabase ${API_URL}"
