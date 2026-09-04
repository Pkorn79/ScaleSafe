#!/usr/bin/env bash
set -euo pipefail

# ISOLATED DATABASE ONLY.
# Usage:
#   ./scripts/verify-command-center-phase2-concurrency.sh \
#     postgresql://postgres:postgres@127.0.0.1:54322/postgres

DB_URL="${1:-}"
if [[ -z "$DB_URL" ]]; then
  echo "Provide the isolated database URL." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_ID="$(date -u +%Y%m%d%H%M%S)"
WINDOW_START_EPOCH="$(date -u +%s)"
WINDOW_END_EPOCH="$((WINDOW_START_EPOCH + 300))"
POSTGRES_IMAGE="public.ecr.aws/supabase/postgres:17.6.1.143"

run_pgbench() {
  if pgbench --version >/dev/null 2>&1; then
    command pgbench "$@"
    return
  fi
  if docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1; then
    docker run --rm --network host \
      -v "${SCRIPT_DIR}:${SCRIPT_DIR}:ro" \
      "$POSTGRES_IMAGE" pgbench "$@"
    return
  fi
  echo "pgbench is unavailable on the host and in the approved local container image." >&2
  exit 1
}

run_pgbench "$DB_URL" \
  -n \
  -c 20 \
  -j 4 \
  -t 1 \
  -D "run_id=${RUN_ID}" \
  -f "${SCRIPT_DIR}/command-center-phase2-observation.pgbench.sql" \
  >/dev/null

OBSERVATION_RESULT="$(
  psql "$DB_URL" -X -At \
    -c "SELECT
      (SELECT count(*) FROM health_current
        WHERE scope_type = 'platform'
          AND scope_id = 'phase2-concurrency-${RUN_ID}'
          AND check_key = 'security.dangerous_flag_posture'),
      (SELECT count(*) FROM platform_incidents
        WHERE scope_type = 'platform'
          AND scope_id = 'phase2-concurrency-${RUN_ID}'
          AND check_key = 'security.dangerous_flag_posture'
          AND status IN ('open', 'acknowledged', 'mitigating', 'suppressed')),
      (SELECT COALESCE(max(occurrence_count), 0) FROM platform_incidents
        WHERE scope_type = 'platform'
          AND scope_id = 'phase2-concurrency-${RUN_ID}'
          AND check_key = 'security.dangerous_flag_posture');"
)"

IFS='|' read -r HEALTH_ROW_COUNT INCIDENT_COUNT OCCURRENCE_COUNT <<<"$OBSERVATION_RESULT"
if [[ "$HEALTH_ROW_COUNT" != "1" || "$INCIDENT_COUNT" != "1" || "$OCCURRENCE_COUNT" -lt 1 ]]; then
  echo "Concurrent observation assertion failed: ${OBSERVATION_RESULT}" >&2
  exit 1
fi

psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -c "DELETE FROM scheduled_job_runs WHERE job_key = 'job.health_retention';" \
  >/dev/null

run_pgbench "$DB_URL" \
  -n \
  -c 20 \
  -j 4 \
  -t 1 \
  -D "window_start_epoch=${WINDOW_START_EPOCH}" \
  -D "window_end_epoch=${WINDOW_END_EPOCH}" \
  -f "${SCRIPT_DIR}/command-center-phase2-job-claim.pgbench.sql" \
  >/dev/null

JOB_RESULT="$(
  psql "$DB_URL" -X -At \
    -c "SELECT
      count(*),
      count(*) FILTER (WHERE status = 'running'),
      COALESCE(max(attempt_count), 0)
    FROM scheduled_job_runs
    WHERE job_key = 'job.health_retention'
      AND scheduled_window_start = to_timestamp(${WINDOW_START_EPOCH});"
)"

if [[ "$JOB_RESULT" != "1|1|1" ]]; then
  echo "Concurrent job-claim assertion failed: ${JOB_RESULT}" >&2
  exit 1
fi

echo "CONCURRENCY VERIFIED: one incident and one scheduled-job owner across 20 clients"
