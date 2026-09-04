#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-}"
if [[ -z "$APP_DIR" || ! -f "$APP_DIR/soak.pid" ]]; then
  echo "Usage: $0 <application-build-with-soak.pid>" >&2
  exit 2
fi

SOAK_PID="$(cat "$APP_DIR/soak.pid")"
if kill -0 "$SOAK_PID" 2>/dev/null; then
  kill "$SOAK_PID"
  for _ in {1..20}; do
    if ! kill -0 "$SOAK_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
fi

if kill -0 "$SOAK_PID" 2>/dev/null; then
  echo "The soak process did not stop cleanly." >&2
  exit 1
fi

echo "SOAK STOPPED: PID ${SOAK_PID}"
