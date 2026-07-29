#!/usr/bin/env bash
# ENABLE_EVAL_RUN_API=false 403s POST /api/v1/evals/:suite/:id/run without
# affecting GET /api/v1/evals (discovery is never gated by this flag), and the
# orchestrator returns to normal once the flag is restored. Mirrors the
# env-flip + --no-deps --force-recreate + restore-in-trap pattern from
# workflows/iot-sensor-pipeline/setpoint-evals/SE-07-feature-flag-layering.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: this SE is FLAT under setpoint-evals/ (SE-01..SE-19 convention), so se-lib.sh is 2
# levels up (mirrors SE-14/SE-15's own path comment).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-19: ENABLE_EVAL_RUN_API=false -> 403 (discovery ungated, flag restorable)"

ENV_FILE="$ROOT/.env"
COMPOSE_MAIN="$ROOT/docker-compose.yml"
FLAG_LINE_PATTERN='^ENABLE_EVAL_RUN_API='
ENV_BACKUP=""

if [ ! -f "$ENV_FILE" ]; then
  se_skip "no .env at repo root — cannot safely test the env-var gate without one"
fi

# --- preflight ---------------------------------------------------------------
# Retry-poll (loaded hosts boot the orchestrator slowly after recreate-heavy SEs)
se_wait_orchestrator_health 90 2 \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
docker compose version >/dev/null 2>&1 || se_skip "docker compose CLI not available"

EVALS_API="${ORCHESTRATOR_HOST}/api/${API_VERSION}/evals"

# --- arrange: snapshot .env so it can be restored no matter what happens -----
ENV_BACKUP="$(mktemp)"
cp "$ENV_FILE" "$ENV_BACKUP"

wait_for_orchestrator_health() {
  local tries=0
  until curl -sf -m 3 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -gt 60 ] && return 1
    sleep 2
  done
  return 0
}

set_flag_and_recreate() {
  local value="$1"
  sed -i "/${FLAG_LINE_PATTERN}/d" "$ENV_FILE"
  printf '\nENABLE_EVAL_RUN_API=%s\n' "$value" >> "$ENV_FILE"
  ( cd "$ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" \
      --profile db --profile orchestrator --profile dev-tools \
      up -d --no-deps --force-recreate orchestrator ) >/dev/null
  wait_for_orchestrator_health
}

restore_env_and_orchestrator() {
  if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    rm -f "$ENV_BACKUP"
  fi
  ( cd "$ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" \
      --profile db --profile orchestrator --profile dev-tools \
      up -d --no-deps --force-recreate orchestrator ) >/dev/null 2>&1 || true
  wait_for_orchestrator_health || log_warn "orchestrator did not confirm healthy during final restore"
}
trap restore_env_and_orchestrator EXIT

# --- act: flag OFF -------------------------------------------------------------
set_flag_and_recreate "false" || { log_fail "orchestrator did not come back healthy with the flag off"; exit 1; }

RESP_RUN_OFF=$(curl -s -w '\n%{http_code}' -m 10 -X POST "${EVALS_API}/core/SE-04-ack-delays/run")
CODE_RUN_OFF=$(echo "$RESP_RUN_OFF" | tail -n1)
BODY_RUN_OFF=$(echo "$RESP_RUN_OFF" | sed '$d')

CODE_DISCOVERY_OFF=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "${EVALS_API}")

# --- act: flag back ON ---------------------------------------------------------
set_flag_and_recreate "true" || { log_fail "orchestrator did not come back healthy with the flag restored"; exit 1; }

RESP_RUN_ON=$(curl -s -w '\n%{http_code}' -m 15 -X POST "${EVALS_API}/core/SE-04-ack-delays/run")
CODE_RUN_ON=$(echo "$RESP_RUN_ON" | tail -n1)
BODY_RUN_ON=$(echo "$RESP_RUN_ON" | sed '$d')

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "with the flag off, POST /run returns HTTP 403" "$CODE_RUN_OFF" "403"
ck_absent "the 403 response body carries no jobId" <(echo "$BODY_RUN_OFF") '"jobId"'
ck_eq "with the flag off, GET /api/v1/evals still returns HTTP 200" "$CODE_DISCOVERY_OFF" "200"
ck_eq "restoring the flag makes POST /run succeed again (201)" "$CODE_RUN_ON" "201"
ck_has "the restored run's response has a jobId" "$BODY_RUN_ON" '"jobId"'

se_summary
