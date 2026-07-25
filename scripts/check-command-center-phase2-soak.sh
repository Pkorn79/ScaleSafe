#!/usr/bin/env bash
set -euo pipefail

# ISOLATED VPS USE ONLY.
# Captures a pre-soak write-counter baseline and reports the running Phase 2
# soak against the approved 24-hour resource budget.

MODE="${1:-}"
SUPABASE_DIR="${2:-}"
APP_DIR="${3:-}"
PORT="${4:-3104}"

if [[ "$MODE" != "init" && "$MODE" != "check" ]]; then
  echo "Usage: $0 <init|check> <supabase-workspace> <application-build> [port]" >&2
  exit 2
fi

if [[ -z "$SUPABASE_DIR" || -z "$APP_DIR" || ! -d "$SUPABASE_DIR" || ! -d "$APP_DIR" ]]; then
  echo "Supabase workspace or application build is missing." >&2
  exit 2
fi

SUPABASE_ENV="$(cd "$SUPABASE_DIR" && supabase status -o env 2>/dev/null)"
eval "$SUPABASE_ENV"

if [[ "${DB_URL:-}" != postgresql://*127.0.0.1:* ]]; then
  echo "Refusing to inspect a non-loopback database." >&2
  exit 1
fi

BASELINE_FILE="$APP_DIR/soak-baseline.env"
BASELINE_TIME_FILE="$APP_DIR/soak-baseline-at.txt"
START_TIME_FILE="$APP_DIR/soak-started-at.txt"
PID_FILE="$APP_DIR/soak.pid"
LOG_FILE="$APP_DIR/soak.log"

table_write_count() {
  local tables="$1"
  psql "$DB_URL" -X -Atc "
    SELECT COALESCE(SUM(n_tup_ins + n_tup_upd + n_tup_del), 0)::bigint
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
      AND relname = ANY (ARRAY[$tables]::text[]);
  "
}

flush_database_stats() {
  psql "$DB_URL" -X -Atc "SELECT pg_stat_force_next_flush();" >/dev/null
}

if [[ "$MODE" == "init" ]]; then
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Stop the isolated application before capturing the soak baseline." >&2
    exit 1
  fi

  flush_database_stats
  HEARTBEAT_WRITES="$(table_write_count "'service_heartbeats'")"
  SCHEDULED_JOB_WRITES="$(table_write_count "'scheduled_job_runs'")"
  METRIC_WRITES="$(table_write_count "'application_metric_buckets'")"
  OTHER_HEALTH_WRITES="$(table_write_count \
    "'health_current','health_observations','merchant_health_rollups','platform_incidents','incident_events','health_dirty_scopes'")"

  {
    printf 'BASELINE_HEARTBEAT_WRITES=%s\n' "$HEARTBEAT_WRITES"
    printf 'BASELINE_SCHEDULED_JOB_WRITES=%s\n' "$SCHEDULED_JOB_WRITES"
    printf 'BASELINE_METRIC_WRITES=%s\n' "$METRIC_WRITES"
    printf 'BASELINE_OTHER_HEALTH_WRITES=%s\n' "$OTHER_HEALTH_WRITES"
  } > "$BASELINE_FILE"
  date -u +%Y-%m-%dT%H:%M:%SZ > "$BASELINE_TIME_FILE"
  chmod 600 "$BASELINE_FILE" "$BASELINE_TIME_FILE"

  echo "SOAK BASELINE CAPTURED"
  exit 0
fi

if [[ ! -f "$BASELINE_FILE" || ! -f "$START_TIME_FILE" || ! -f "$PID_FILE" ]]; then
  echo "Soak baseline, start time, or PID is missing." >&2
  exit 2
fi

# The baseline file is generated locally by this script and contains integers.
source "$BASELINE_FILE"

STARTED_AT="$(cat "$START_TIME_FILE")"
START_EPOCH="$(date -u -d "$STARTED_AT" +%s)"
NOW_EPOCH="$(date -u +%s)"
METRIC_WINDOW_STARTED_AT="$(psql "$DB_URL" -X -Atc "
  SELECT to_char(
    date_trunc('hour', '$STARTED_AT'::timestamptz)
      + make_interval(
          mins => (extract(minute FROM '$STARTED_AT'::timestamptz)::integer / 5) * 5
        ),
    'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'
  );
")"
ELAPSED_SECONDS=$((NOW_EPOCH - START_EPOCH))
if (( ELAPSED_SECONDS < 0 )); then
  echo "Soak start time is in the future." >&2
  exit 1
fi
ELAPSED_HOURS="$(awk -v seconds="$ELAPSED_SECONDS" 'BEGIN { printf "%.2f", seconds / 3600 }')"

SOAK_PID="$(cat "$PID_FILE")"
PROCESS_ALIVE=false
HEALTH_ENDPOINT_OK=false
if kill -0 "$SOAK_PID" 2>/dev/null; then
  PROCESS_ALIVE=true
  if curl --fail --silent --show-error "http://127.0.0.1:${PORT}/health" >/dev/null; then
    HEALTH_ENDPOINT_OK=true
  fi
fi

flush_database_stats
CURRENT_HEARTBEAT_WRITES="$(table_write_count "'service_heartbeats'")"
CURRENT_SCHEDULED_JOB_WRITES="$(table_write_count "'scheduled_job_runs'")"
CURRENT_METRIC_WRITES="$(table_write_count "'application_metric_buckets'")"
CURRENT_OTHER_HEALTH_WRITES="$(table_write_count \
  "'health_current','health_observations','merchant_health_rollups','platform_incidents','incident_events','health_dirty_scopes'")"

HEARTBEAT_WRITES=$((CURRENT_HEARTBEAT_WRITES - BASELINE_HEARTBEAT_WRITES))
SCHEDULED_JOB_WRITES=$((CURRENT_SCHEDULED_JOB_WRITES - BASELINE_SCHEDULED_JOB_WRITES))
METRIC_WRITES=$((CURRENT_METRIC_WRITES - BASELINE_METRIC_WRITES))
OTHER_HEALTH_WRITES=$((CURRENT_OTHER_HEALTH_WRITES - BASELINE_OTHER_HEALTH_WRITES))

for value_name in HEARTBEAT_WRITES SCHEDULED_JOB_WRITES METRIC_WRITES OTHER_HEALTH_WRITES; do
  if (( ${!value_name} < 0 )); then
    echo "PostgreSQL statistics reset during the soak; write deltas are no longer valid." >&2
    exit 1
  fi
done

IFS='|' read -r \
  SCHEMA_VERSION \
  METRIC_ROWS \
  HTTP_REQUESTS \
  SUPABASE_REQUESTS \
  COMMAND_CENTER_SUPABASE_REQUESTS \
  PROVIDER_REQUESTS \
  HTTP_5XX \
  DATABASE_TIMEOUTS \
  DATABASE_CANARY_FAILURES \
  SCHEDULED_JOB_RECORDS \
  HEALTH_RECONCILIATION_RUNS \
  FAILED_JOB_RUNS \
  NONHEALTHY_WORKERS \
  HEALTH_OBSERVATIONS \
  NONHEALTHY_OBSERVATIONS \
  INCIDENTS_CREATED \
  INCIDENT_EVENTS_CREATED \
  OPEN_INCIDENTS \
  NONHEALTHY_CURRENT \
  MERCHANTS \
  <<< "$(psql "$DB_URL" -X -At -F '|' -c "
    SELECT
      scalesafe_schema_version(),
      (SELECT count(*) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT COALESCE(sum(request_count), 0) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT COALESCE(sum(supabase_request_count), 0) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT COALESCE(sum(command_center_supabase_request_count), 0) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT COALESCE(sum(provider_request_count), 0) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT COALESCE(sum(server_error_count), 0) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT COALESCE(sum(database_timeout_count), 0) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz),
      (SELECT count(*) FROM application_metric_buckets WHERE bucket_started_at >= '$METRIC_WINDOW_STARTED_AT'::timestamptz AND database_canary_failed),
      (SELECT count(*) FROM scheduled_job_runs
        WHERE created_at >= '$STARTED_AT'::timestamptz
          AND job_key NOT IN (
            'job.command_center_health_reconcile',
            'job.merchant_health_full_sweep'
          )),
      (SELECT count(*) FROM scheduled_job_runs
        WHERE created_at >= '$STARTED_AT'::timestamptz
          AND job_key IN ('job.command_center_health_reconcile', 'job.merchant_health_full_sweep')),
      (SELECT count(*) FROM scheduled_job_runs
        WHERE created_at >= '$STARTED_AT'::timestamptz
          AND status IN ('failed', 'timed_out', 'exhausted', 'missed')),
      (SELECT count(*) FROM service_heartbeats WHERE state <> 'healthy'),
      (SELECT count(*) FROM health_observations WHERE created_at >= '$STARTED_AT'::timestamptz),
      (SELECT count(*) FROM health_observations
        WHERE created_at >= '$STARTED_AT'::timestamptz
          AND state NOT IN ('healthy', 'not_applicable')),
      (SELECT count(*) FROM platform_incidents WHERE created_at >= '$STARTED_AT'::timestamptz),
      (SELECT count(*) FROM incident_events WHERE created_at >= '$STARTED_AT'::timestamptz),
      (SELECT count(*) FROM platform_incidents WHERE status <> 'resolved'),
      (SELECT count(*) FROM health_current WHERE state NOT IN ('healthy', 'not_applicable')),
      (SELECT count(*) FROM merchants);
  ")"

LOG_ERRORS=0
if [[ -f "$LOG_FILE" ]]; then
  LOG_ERRORS="$(grep -Eic '(^|[^A-Za-z])(ERROR|FATAL|Unhandled|ECONNREFUSED|ECONNRESET)([^A-Za-z]|$)' "$LOG_FILE" || true)"
fi

FAILURES=()
[[ "$PROCESS_ALIVE" == true ]] || FAILURES+=("process_not_running")
[[ "$HEALTH_ENDPOINT_OK" == true ]] || FAILURES+=("health_endpoint_failed")
[[ "$SCHEMA_VERSION" == "104" ]] || FAILURES+=("wrong_schema_version")
(( HTTP_5XX == 0 )) || FAILURES+=("http_5xx_observed")
(( DATABASE_TIMEOUTS == 0 )) || FAILURES+=("database_timeouts_observed")
(( DATABASE_CANARY_FAILURES == 0 )) || FAILURES+=("database_canary_failed")
(( FAILED_JOB_RUNS == 0 )) || FAILURES+=("scheduled_job_failure")
(( NONHEALTHY_WORKERS == 0 )) || FAILURES+=("nonhealthy_worker")
(( NONHEALTHY_OBSERVATIONS == 0 )) || FAILURES+=("nonhealthy_observation_history")
(( NONHEALTHY_CURRENT == 0 )) || FAILURES+=("nonhealthy_current_health")
(( OPEN_INCIDENTS == 0 )) || FAILURES+=("open_incident")
(( PROVIDER_REQUESTS == 0 )) || FAILURES+=("provider_request_observed")
(( LOG_ERRORS == 0 )) || FAILURES+=("application_log_error")
(( MERCHANTS == 0 )) || FAILURES+=("provider_request_zero-proof_invalid")

# The acceptance contract permits at most 10 percent overage before failure.
(( HEARTBEAT_WRITES <= 2750 )) || FAILURES+=("heartbeat_write_budget")
(( HEALTH_RECONCILIATION_RUNS <= 330 )) || FAILURES+=("health_reconciliation_budget")
(( SCHEDULED_JOB_RECORDS <= 385 )) || FAILURES+=("scheduled_job_record_budget")
(( METRIC_ROWS <= 330 )) || FAILURES+=("application_metric_budget")
(( OTHER_HEALTH_WRITES <= 110 )) || FAILURES+=("other_health_write_budget")
(( COMMAND_CENTER_SUPABASE_REQUESTS <= 4950 )) || FAILURES+=("command_center_supabase_request_budget")

STATUS="in_progress"
if (( ${#FAILURES[@]} > 0 )); then
  STATUS="failed"
elif (( ELAPSED_SECONDS >= 86400 )); then
  STATUS="healthy"
fi

FAILURE_JSON=""
for reason in "${FAILURES[@]}"; do
  [[ -z "$FAILURE_JSON" ]] || FAILURE_JSON+=", "
  FAILURE_JSON+="\"$reason\""
done

cat <<JSON
{
  "status": "$STATUS",
  "started_at_utc": "$STARTED_AT",
  "elapsed_hours": $ELAPSED_HOURS,
  "process": {
    "pid": $SOAK_PID,
    "alive": $PROCESS_ALIVE,
    "health_endpoint_ok": $HEALTH_ENDPOINT_OK,
    "log_error_matches": $LOG_ERRORS
  },
  "database": {
    "schema_version": $SCHEMA_VERSION,
    "merchant_count": $MERCHANTS,
    "open_incidents": $OPEN_INCIDENTS,
    "nonhealthy_current_checks": $NONHEALTHY_CURRENT,
    "nonhealthy_workers": $NONHEALTHY_WORKERS,
    "failed_job_runs": $FAILED_JOB_RUNS
  },
  "budget": {
    "heartbeat_writes": {"actual": $HEARTBEAT_WRITES, "limit": 2500},
    "health_reconciliation_runs": {"actual": $HEALTH_RECONCILIATION_RUNS, "limit": 300},
    "scheduled_job_records": {"actual": $SCHEDULED_JOB_RECORDS, "limit": 350},
    "scheduled_job_write_operations": $SCHEDULED_JOB_WRITES,
    "application_metric_rows": {"actual": $METRIC_ROWS, "limit": 300},
    "application_metric_write_operations": $METRIC_WRITES,
    "other_health_write_operations": {"actual": $OTHER_HEALTH_WRITES, "limit": 100},
    "supabase_requests_total": {"actual": $SUPABASE_REQUESTS, "purpose": "platform diagnostic denominator"},
    "command_center_supabase_requests": {"actual": $COMMAND_CENTER_SUPABASE_REQUESTS, "limit": 4500},
    "provider_requests": {"actual": $PROVIDER_REQUESTS, "proof": "measured outbound provider hosts"}
  },
  "observed": {
    "http_requests": $HTTP_REQUESTS,
    "http_5xx": $HTTP_5XX,
    "database_timeouts": $DATABASE_TIMEOUTS,
    "database_canary_failures": $DATABASE_CANARY_FAILURES,
    "health_observations": $HEALTH_OBSERVATIONS,
    "nonhealthy_observations": $NONHEALTHY_OBSERVATIONS,
    "incidents_created": $INCIDENTS_CREATED,
    "incident_events_created": $INCIDENT_EVENTS_CREATED
  },
  "failures": [$FAILURE_JSON]
}
JSON

[[ "$STATUS" != "failed" ]]
