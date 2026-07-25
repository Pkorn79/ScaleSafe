#!/usr/bin/env bash
set -euo pipefail

# ISOLATED DATABASE AND APPLICATION ONLY.

DB_URL="${1:-}"
APP_URL="${2:-}"
OPERATOR_HOST="${3:-ops.phase2.local}"

if [[ "$DB_URL" != *"@127.0.0.1:"* && "$DB_URL" != *"@localhost:"* ]]; then
  echo "Refusing a non-loopback database." >&2
  exit 1
fi
if [[ "$APP_URL" != http://127.0.0.1:* && "$APP_URL" != http://localhost:* ]]; then
  echo "Refusing a non-loopback application." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

seed_and_reconcile() {
  local target="$1"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -v target="$target" <<'SQL' >/dev/null
INSERT INTO merchants (
  location_id,
  business_name,
  status,
  snapshot_status,
  onboarding_complete,
  marketplace_plan_key,
  marketplace_billing_status
)
SELECT
  'cc-scale-' || lpad(merchant_number::text, 5, '0'),
  'Command Center Scale Merchant ' || merchant_number,
  'active',
  'installed',
  true,
  'standard',
  'complete'
FROM generate_series(1, :target) AS merchant_number
ON CONFLICT (location_id) DO NOTHING;

SELECT set_config('scalesafe.scale_target', :'target', false);

DO $$
DECLARE
  v_target INTEGER := current_setting('scalesafe.scale_target')::integer;
  v_offset INTEGER := 0;
  v_locations TEXT[];
  v_started_at TIMESTAMPTZ;
  v_elapsed_ms NUMERIC;
  v_max_elapsed_ms NUMERIC := 0;
BEGIN
  LOOP
    SELECT array_agg(location_id ORDER BY location_id)
    INTO v_locations
    FROM (
      SELECT location_id
      FROM merchants
      WHERE location_id LIKE 'cc-scale-%'
      ORDER BY location_id
      OFFSET v_offset
      LIMIT 1000
    ) page;
    EXIT WHEN COALESCE(array_length(v_locations, 1), 0) = 0;

    v_started_at := clock_timestamp();
    PERFORM reconcile_command_center_merchant_health(v_locations);
    v_elapsed_ms := extract(epoch FROM clock_timestamp() - v_started_at) * 1000;
    v_max_elapsed_ms := GREATEST(v_max_elapsed_ms, v_elapsed_ms);
    IF v_elapsed_ms > 5000 THEN
      RAISE EXCEPTION '1,000-merchant batch exceeded 5,000 ms: %', v_elapsed_ms;
    END IF;
    v_offset := v_offset + 1000;
  END LOOP;

  IF (
    SELECT count(*)
    FROM merchant_health_rollups
    WHERE location_id LIKE 'cc-scale-%'
  ) <> v_target THEN
    RAISE EXCEPTION 'Scale rollup count did not reach target %', v_target;
  END IF;
  RAISE NOTICE 'Target % ready; maximum reconciliation batch % ms',
    v_target,
    round(v_max_elapsed_ms, 2);
END;
$$;
SQL
}

measure_overview() {
  local target="$1"
  local timings="$TMP_DIR/timings-${target}.txt"
  local response="$TMP_DIR/overview-${target}.json"
  : >"$timings"

  for _ in $(seq 1 5); do
    curl --fail --silent --show-error \
      --header "Host: ${OPERATOR_HOST}" \
      --header 'Cookie: __Host-scalesafe_ops=phase2-owner-session' \
      "${APP_URL}/internal/operator/api/health?limit=50" >/dev/null
  done
  for _ in $(seq 1 30); do
    curl --fail --silent --show-error \
      --output "$response" \
      --write-out '%{time_total}\n' \
      --header "Host: ${OPERATOR_HOST}" \
      --header 'Cookie: __Host-scalesafe_ops=phase2-owner-session' \
      "${APP_URL}/internal/operator/api/health?limit=50" >>"$timings"
  done

  local p95
  p95="$(
    sort -n "$timings" |
      awk '{ sample[NR] = $1 } END {
        idx = int((NR * 95 + 99) / 100);
        if (idx < 1) idx = 1;
        print sample[idx];
      }'
  )"
  if ! awk -v value="$p95" 'BEGIN { exit !(value <= 0.300) }'; then
    echo "${target}-merchant platform overview exceeded 300 ms p95: ${p95}s" >&2
    exit 1
  fi
  echo "SCALE ${target}: platform overview p95 ${p95}s"
}

for target in 100 1000 10000; do
  seed_and_reconcile "$target"
  measure_overview "$target"
done

CURSOR=''
PAGE=0
SEEN="$TMP_DIR/seen-scale-locations.txt"
: >"$SEEN"
while (( PAGE < 60 )); do
  URL="${APP_URL}/internal/operator/api/health?limit=200"
  if [[ -n "$CURSOR" ]]; then
    URL="${URL}&merchantsCursor=${CURSOR}"
  fi
  RESPONSE="$TMP_DIR/page-${PAGE}.json"
  curl --fail --silent --show-error \
    --output "$RESPONSE" \
    --header "Host: ${OPERATOR_HOST}" \
    --header 'Cookie: __Host-scalesafe_ops=phase2-owner-session' \
    "$URL"

  node -e "
    const data = require(process.argv[1]);
    for (const merchant of data.merchants || []) {
      if (String(merchant.location_id || '').startsWith('cc-scale-')) {
        process.stdout.write(String(merchant.location_id) + '\\n');
      }
    }
  " "$RESPONSE" >>"$SEEN"
  CURSOR="$(
    node -e "
      const data = require(process.argv[1]);
      process.stdout.write(String(data.pagination?.merchantsCursor || ''));
    " "$RESPONSE"
  )"
  PAGE=$((PAGE + 1))
  [[ -n "$CURSOR" ]] || break
done

UNIQUE_COUNT="$(sort -u "$SEEN" | wc -l | tr -d ' ')"
TOTAL_COUNT="$(wc -l <"$SEEN" | tr -d ' ')"
if [[ "$UNIQUE_COUNT" != "10000" || "$TOTAL_COUNT" != "10000" ]]; then
  echo "Merchant pagination failed: total ${TOTAL_COUNT}, unique ${UNIQUE_COUNT}" >&2
  exit 1
fi

echo "SCALE VERIFIED: 100, 1,000, and 10,000 merchants meet HTTP p95; 10,000-row cursor traversal is complete and duplicate-free"
