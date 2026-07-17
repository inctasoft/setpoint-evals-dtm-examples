#!/usr/bin/env bash
# SE-26: GET /api/v1/workflows/:workflowName/steps/:stepName/history?limit=N — the
# cross-job "recent runs of this step" contract (capability-spec.md §3.2b, dtm-video-v2
# Lane A). Reads the 19 real order-processing jobs already on the dev stack instead of
# seeding fresh ones. Loudly SKIPs (never fake-greens) if fewer than 2 exist.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-26: GET workflows/:workflowName/steps/:stepName/history — cross-job history contract"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v jq >/dev/null 2>&1 || se_skip "jq is required"
DB_CONTAINER="${COMPOSE_PROJECT_NAME:-dtm}-db"
docker exec "$DB_CONTAINER" true >/dev/null 2>&1 \
  || se_skip "DB container ${DB_CONTAINER} not reachable (docker exec failed)"

API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"
psql_q() { docker exec "$DB_CONTAINER" psql -U dtm_user -d dtm -t -A -F'|' -c "$1" 2>/dev/null; }

# ═══════════════════════════════════════════════════════════════════════════
# 1+ 2 + 3. limit / ordering / status parity — order-processing / ValidateCustomer
# ═══════════════════════════════════════════════════════════════════════════
DB_JOB_COUNT=$(psql_q "SELECT count(*) FROM dtm_steps s JOIN dtm_jobs j ON j.id=s.job_id WHERE j.workflow_name='order-processing' AND s.step_value='ValidateCustomer' AND s.parent_step_id IS NULL;")
if [ "${DB_JOB_COUNT:-0}" -lt 2 ]; then
  se_skip "fewer than 2 order-processing jobs with ValidateCustomer exist (${DB_JOB_COUNT:-0}) — run workflows/order-processing/setpoint-evals/* a couple of times first"
fi

DB_TOP2=$(psql_q "SELECT s.job_id, s.status FROM dtm_steps s JOIN dtm_jobs j ON j.id=s.job_id WHERE j.workflow_name='order-processing' AND s.step_value='ValidateCustomer' AND s.parent_step_id IS NULL ORDER BY j.submitted_at DESC LIMIT 2;")
DB_JOB_1=$(echo "$DB_TOP2" | sed -n '1p' | cut -d'|' -f1)
DB_STATUS_1=$(echo "$DB_TOP2" | sed -n '1p' | cut -d'|' -f2)
DB_JOB_2=$(echo "$DB_TOP2" | sed -n '2p' | cut -d'|' -f1)
DB_STATUS_2=$(echo "$DB_TOP2" | sed -n '2p' | cut -d'|' -f2)
log_info "1. expected top-2 (most-recent-first): ${DB_JOB_1} (${DB_STATUS_1}), ${DB_JOB_2} (${DB_STATUS_2})"

RESP=$(curl -s -w '\n%{http_code}' -m 15 "${API}/workflows/order-processing/steps/ValidateCustomer/history?limit=2")
HTTP=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

ck_eq "1. GET .../history?limit=2 returns HTTP 200" "$HTTP" "200"
API_LEN=$(echo "$BODY" | jq 'length' 2>/dev/null)
ck_eq "1. limit=2 returns exactly 2 rows" "$API_LEN" "2"

API_JOB_1=$(echo "$BODY" | jq -r '.[0].jobId' 2>/dev/null)
API_JOB_2=$(echo "$BODY" | jq -r '.[1].jobId' 2>/dev/null)
ck_eq "2. row 0 is the most-recent job (${DB_JOB_1})" "$API_JOB_1" "$DB_JOB_1"
ck_eq "2. row 1 is the 2nd-most-recent job (${DB_JOB_2})" "$API_JOB_2" "$DB_JOB_2"

API_STATUS_1=$(echo "$BODY" | jq -r '.[0].stepStatus' 2>/dev/null)
ck_eq "3. row 0 stepStatus matches DB (${DB_STATUS_1})" "$API_STATUS_1" "$DB_STATUS_1"

# ═══════════════════════════════════════════════════════════════════════════
# 4. Workflow isolation — ValidateCustomer doesn't exist in iot-sensor-pipeline
# ═══════════════════════════════════════════════════════════════════════════
RESP2=$(curl -s -w '\n%{http_code}' -m 15 "${API}/workflows/iot-sensor-pipeline/steps/ValidateCustomer/history")
HTTP2=$(echo "$RESP2" | tail -n1)
BODY2=$(echo "$RESP2" | sed '$d')
ck_eq "4. iot-sensor-pipeline + ValidateCustomer returns HTTP 200 (workflow is real)" "$HTTP2" "200"
API_LEN2=$(echo "$BODY2" | jq 'length' 2>/dev/null)
ck_eq "4. cross-workflow isolation: 0 rows leak from order-processing" "$API_LEN2" "0"

# ═══════════════════════════════════════════════════════════════════════════
# 5. Registered workflow, zero runs — empty array, not 404
# ═══════════════════════════════════════════════════════════════════════════
PLAN_EXEC_JOBS=$(psql_q "SELECT count(*) FROM dtm_jobs WHERE workflow_name='plan-execution';")
if [ "${PLAN_EXEC_JOBS:-0}" != "0" ]; then
  log_warning "plan-execution now has ${PLAN_EXEC_JOBS} job(s) — the 'zero runs' fixture assumption changed; scenario 5 may not exercise the empty-workflow path"
fi
RESP3=$(curl -s -w '\n%{http_code}' -m 15 "${API}/workflows/plan-execution/steps/AnyStep/history")
HTTP3=$(echo "$RESP3" | tail -n1)
BODY3=$(echo "$RESP3" | sed '$d')
ck_eq "5. registered workflow with zero runs (plan-execution) returns HTTP 200" "$HTTP3" "200"
API_LEN3=$(echo "$BODY3" | jq 'length' 2>/dev/null)
ck_eq "5. ...and an empty array, not a 404" "$API_LEN3" "0"

# ═══════════════════════════════════════════════════════════════════════════
# 6. Unregistered workflow — 404
# ═══════════════════════════════════════════════════════════════════════════
HTTP4=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${API}/workflows/does-not-exist-workflow-xyz/steps/AnyStep/history")
ck_eq "6. unregistered workflow name returns 404" "$HTTP4" "404"

# ═══════════════════════════════════════════════════════════════════════════
# 7. limit is capped at 50 server-side
# ═══════════════════════════════════════════════════════════════════════════
RESP5=$(curl -s -m 15 "${API}/workflows/order-processing/steps/ValidateCustomer/history?limit=999")
API_LEN5=$(echo "$RESP5" | jq 'length' 2>/dev/null)
ck "7. limit=999 never returns more than 50 rows (got ${API_LEN5})" test "${API_LEN5:-999}" -le 50

se_summary
