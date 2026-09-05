#!/usr/bin/env bash
set -euo pipefail

# ISOLATED DATABASE ONLY.
# Replays an explicitly separated set of pending migrations after resetting the
# normal Supabase migration directory. The historical duplicate migration 055
# has been consolidated and no longer requires a special-case workaround.

WORKSPACE="${1:-}"
DB_URL="${2:-}"
NETWORK_ID="${3:-}"

if [[ -z "$WORKSPACE" || -z "$DB_URL" || -z "$NETWORK_ID" || ! -d "$WORKSPACE/pending-migrations" ]]; then
  echo "Usage: $0 <isolated-supabase-workspace> <loopback-database-url> <loopback-docker-network>" >&2
  exit 2
fi

if [[ "$DB_URL" != *"@127.0.0.1:"* && "$DB_URL" != *"@localhost:"* ]]; then
  echo "Refusing to replay against a non-loopback database." >&2
  exit 1
fi

NETWORK_BINDING="$(
  docker network inspect "$NETWORK_ID" \
    --format '{{ index .Options "com.docker.network.bridge.host_binding_ipv4" }}'
)"
if [[ "$NETWORK_BINDING" != "127.0.0.1" ]]; then
  echo "Refusing to use Docker network without loopback-only host binding: $NETWORK_ID" >&2
  exit 1
fi

CONFIG_FILE="$WORKSPACE/supabase/config.toml"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Missing Supabase config: $CONFIG_FILE" >&2
  exit 1
fi

PROJECT_ID="$(awk -F '"' '/^[[:space:]]*project_id[[:space:]]*=/{print $2; exit}' "$CONFIG_FILE")"
if [[ -z "$PROJECT_ID" ]]; then
  echo "Supabase project_id is missing from $CONFIG_FILE" >&2
  exit 1
fi

assert_loopback_ports() {
  local project_bindings
  local unsafe_bindings
  project_bindings="$(
    docker ps --format '{{.Names}}\t{{.Ports}}' \
      | grep -F "_$PROJECT_ID" \
      || true
  )"
  if [[ -z "$project_bindings" ]]; then
    echo "Refusing to continue: no running containers found for project $PROJECT_ID." >&2
    exit 1
  fi

  unsafe_bindings="$(
    printf '%s\n' "$project_bindings" \
      | grep -E '0\.0\.0\.0:|\[::\]:' \
      || true
  )"
  if [[ -n "$unsafe_bindings" ]]; then
    echo "Refusing to continue: disposable Supabase ports are not loopback-only." >&2
    printf '%s\n' "$unsafe_bindings" >&2
    exit 1
  fi
}

cd "$WORKSPACE"
supabase db reset --local --no-seed --network-id "$NETWORK_ID"
assert_loopback_ports

while IFS= read -r migration_file; do
  echo "Applying $(basename "$migration_file")"
  has_begin=false
  has_commit=false
  grep -Eq '^[[:space:]]*BEGIN;[[:space:]]*$' "$migration_file" && has_begin=true
  grep -Eq '^[[:space:]]*COMMIT;[[:space:]]*$' "$migration_file" && has_commit=true

  if [[ "$has_begin" != "$has_commit" ]]; then
    echo "Refusing migration with incomplete transaction boundary: $migration_file" >&2
    exit 1
  fi

  if [[ "$has_begin" == true ]]; then
    psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
  else
    psql "$DB_URL" --single-transaction -X -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
  fi
done < <(find pending-migrations -maxdepth 1 -type f -name '*.sql' | sort)

assert_loopback_ports

echo "ISOLATED REPLAY COMPLETE"
