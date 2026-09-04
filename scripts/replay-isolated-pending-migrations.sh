#!/usr/bin/env bash
set -euo pipefail

# ISOLATED DATABASE ONLY.
# Replays an explicitly separated set of pending migrations after resetting the
# normal Supabase migration directory. The historical duplicate migration 055
# has been consolidated and no longer requires a special-case workaround.

WORKSPACE="${1:-}"
DB_URL="${2:-}"

if [[ -z "$WORKSPACE" || -z "$DB_URL" || ! -d "$WORKSPACE/pending-migrations" ]]; then
  echo "Usage: $0 <isolated-supabase-workspace> <loopback-database-url>" >&2
  exit 2
fi

if [[ "$DB_URL" != *"@127.0.0.1:"* && "$DB_URL" != *"@localhost:"* ]]; then
  echo "Refusing to replay against a non-loopback database." >&2
  exit 1
fi

cd "$WORKSPACE"
supabase db reset --local --no-seed

while IFS= read -r migration_file; do
  echo "Applying $(basename "$migration_file")"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration_file" >/dev/null
done < <(find pending-migrations -maxdepth 1 -type f -name '*.sql' | sort)

echo "ISOLATED REPLAY COMPLETE"
