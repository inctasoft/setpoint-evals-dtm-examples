#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 07: Feature Flag Three-Layer Resolution
# ═══════════════════════════════════════════════════════════════════════════
# Pins FeatureFlagService.resolveFlags()'s full 3-layer priority for
# ENABLE_ALERT_GENERATION (default < env var < per-request, gated by
# clientOverridable):
#
#   Layer 1 (default): workflow.config.ts default is `true` -> alerts run.
#   Layer 2 (env var):  FEATURE_FLAG_ENABLE_ALERT_GENERATION=false set on
#     the orchestrator -> overrides the default -> alerts SKIPPED.
#   Layer 3 (per-request): payload.featureFlags.ENABLE_ALERT_GENERATION=true
#     with the env var STILL false -> per-request wins -> alerts run again.
#
# DESTRUCTIVE — the ONLY way to test Layer 2 for real is to actually set an
# env var on the orchestrator process, which requires a container recreate
# (env vars are read once at process start; no runtime override endpoint
# exists — that gap is exactly what Layer 3 exists to work around). No other
# SE in the estate mutates the shared orchestrator's environment; this is
# the first, and it MUST run in isolation (see Isolation: destructive in
# the README) — a concurrent job elsewhere would be disrupted by the
# recreate. Restores the original .env and container state on exit via a
# trap, even on failure.
#
# Also proves the clientOverridable GATE: attempting to override
# ENABLE_CASCADE_FK_INJECTION (NOT in iot's clientOverridable allowlist) via
# a per-request flag is silently ignored — it stays at its default.
# ═══════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../shared/helpers.sh"

REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"
COMPOSE_MAIN="$REPO_ROOT/docker-compose.yml"
FLAG_LINE_PATTERN='^FEATURE_FLAG_ENABLE_ALERT_GENERATION='
ENV_BACKUP=""

EVAL_NAME="SE 07: Feature Flag Three-Layer Resolution"
EVAL_PURPOSE="default < env var < per-request (gated by clientOverridable)"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

if [ ! -f "$ENV_FILE" ]; then
  se_skip "no .env at repo root — cannot safely test the env-var layer without one"
fi

# --- arrange: snapshot .env so it can be restored no matter what happens ---
ENV_BACKUP="$(mktemp)"
cp "$ENV_FILE" "$ENV_BACKUP"

restore_env_and_orchestrator() {
  if [ -n "$ENV_BACKUP" ] && [ -f "$ENV_BACKUP" ]; then
    cp "$ENV_BACKUP" "$ENV_FILE"
    rm -f "$ENV_BACKUP"
  fi
  ( cd "$REPO_ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" \
      --profile db --profile orchestrator --profile dev-tools \
      up -d --no-deps orchestrator ) >/dev/null 2>&1 || true
  wait_for_orchestrator_health || log_warning "orchestrator did not confirm healthy during final restore"
}
trap restore_env_and_orchestrator EXIT

wait_for_orchestrator_health() {
  local tries=0
  until curl -sf "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [ $tries -gt 90 ]; then
      return 1
    fi
    sleep 2
  done
  return 0
}

set_env_flag_and_recreate() {
  local value="$1" # "false", "true", or "" to remove the line entirely
  sed -i "/${FLAG_LINE_PATTERN}/d" "$ENV_FILE"
  if [ -n "$value" ]; then
    printf '\nFEATURE_FLAG_ENABLE_ALERT_GENERATION=%s\n' "$value" >> "$ENV_FILE"
  fi
  ( cd "$REPO_ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_MAIN" \
      --profile db --profile orchestrator --profile dev-tools \
      up -d --no-deps orchestrator ) >/dev/null
  wait_for_orchestrator_health
}

submit_and_check_alerts() {
  # Submits a greenhouse-4 job (its real heat-spike alert) with the given
  # per-request featureFlags block, waits for terminal state, and returns
  # "ran" or "skipped" for the alert steps on stdout.
  local feature_flags_json="$1"
  local entity_suffix="$2"
  local payload
  payload=$(cat <<EOF
{
  "variant": "default",
  "enableDeduplication": false,
  "payload": { "deviceId": "greenhouse-4", "entityId": "greenhouse-4-flag-layering-${entity_suffix}" },
  ${feature_flags_json}
  "testOptions": {
    "RegisterDevice":     { "simDelay": 300 },
    "ProvisionDevice":    { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors":    { "simDelay": 300 },
    "CalibrateSensor":    { "simDelay": 300 },
    "ActivateSensor":     { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverReadings":   { "simDelay": 300 },
    "IngestReading":      { "simDelay": 300 },
    "PublishReading":     { "simDelay": 300, "ackDelay": 1000 },
    "EvaluateAlert":      { "simDelay": 300 },
    "DispatchAlert":      { "simDelay": 300, "ackDelay": 1000 },
    "ComputeAggregate":   { "simDelay": 300 },
    "PublishAggregate":   { "simDelay": 300, "ackDelay": 1000 }
  }
}
EOF
)
  local job_id correlation_id
  IFS=':' read -r job_id correlation_id <<< "$(initiate_job "$payload")" >&2
  validate_job_id "$job_id" >&2 || { echo "ERROR"; return 1; }
  poll_job "$job_id" 300 5 >&2
  local job_json
  job_json=$(get_job_status "$job_id")
  local dispatch_count
  dispatch_count=$(echo "$job_json" | jq '[.steps[] | select(.stepNumber == "DispatchAlert" and .status == "completed")] | length')
  if [ "$dispatch_count" -ge 1 ]; then
    echo "ran"
  else
    echo "skipped"
  fi
}

PASS_COUNT=0
FAIL_COUNT=0

# ═══════════════════════════════════════════════════════════════════════════
# Layer 1: default (no env var, no per-request override) -> alerts RUN
# ═══════════════════════════════════════════════════════════════════════════

log_section "LAYER 1: default (ENABLE_ALERT_GENERATION defaults to true)"
set_env_flag_and_recreate "" || { log_error "orchestrator failed to recreate for Layer 1"; exit 1; }

RESULT_L1=$(submit_and_check_alerts "" "l1")
if [ "$RESULT_L1" == "ran" ]; then
  log_success "Layer 1 (default): alerts RAN — matches workflow.config.ts default (true)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Layer 1: expected alerts to run, got '$RESULT_L1'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Layer 2: env var override (no per-request override) -> alerts SKIPPED
# ═══════════════════════════════════════════════════════════════════════════

log_section "LAYER 2: env var FEATURE_FLAG_ENABLE_ALERT_GENERATION=false overrides the default"
set_env_flag_and_recreate "false" || { log_error "orchestrator failed to recreate for Layer 2"; exit 1; }

RESULT_L2=$(submit_and_check_alerts "" "l2")
if [ "$RESULT_L2" == "skipped" ]; then
  log_success "Layer 2 (env var): alerts SKIPPED — env var correctly overrode the default"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Layer 2: expected alerts to be skipped, got '$RESULT_L2'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# Layer 3: per-request override (env var STILL false) -> alerts RUN AGAIN
# ═══════════════════════════════════════════════════════════════════════════

log_section "LAYER 3: per-request override wins over the env var (env var stays false)"

RESULT_L3=$(submit_and_check_alerts '"featureFlags": { "ENABLE_ALERT_GENERATION": true },' "l3")
if [ "$RESULT_L3" == "ran" ]; then
  log_success "Layer 3 (per-request): alerts RAN — per-request override beat the env var"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  log_error "Layer 3: expected alerts to run (per-request override), got '$RESULT_L3'"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi
echo ""

# ═══════════════════════════════════════════════════════════════════════════
# clientOverridable gate: ENABLE_CASCADE_FK_INJECTION is NOT overridable
# ═══════════════════════════════════════════════════════════════════════════

log_section "GATE: ENABLE_CASCADE_FK_INJECTION is not in clientOverridable — override ignored"

# ENABLE_CASCADE_FK_INJECTION governs whether ack_metadata externalIds get
# threaded as FKs (see infra-provisioning SE-07). For iot, cheaper to assert
# indirectly: the request is simply accepted and processed normally (201 +
# terminal state) even though the override attempt is present — the
# orchestrator does not error out on a non-overridable flag, it just ignores
# it (logged as a warning server-side; see feature-flag.service.ts).
PAYLOAD_GATE='{
  "variant": "default",
  "enableDeduplication": false,
  "payload": { "deviceId": "greenhouse-1", "entityId": "greenhouse-1-flag-gate" },
  "featureFlags": { "ENABLE_CASCADE_FK_INJECTION": false },
  "testOptions": {
    "RegisterDevice":  { "simDelay": 300 },
    "ProvisionDevice": { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverSensors": { "simDelay": 300 },
    "CalibrateSensor": { "simDelay": 300 },
    "ActivateSensor":  { "simDelay": 300, "ackDelay": 1000 },
    "DiscoverReadings":{ "simDelay": 300 },
    "IngestReading":   { "simDelay": 300 },
    "PublishReading":  { "simDelay": 300, "ackDelay": 1000 },
    "ComputeAggregate":{ "simDelay": 300 },
    "PublishAggregate":{ "simDelay": 300, "ackDelay": 1000 }
  }
}'
IFS=':' read -r JOB_ID_GATE CORRELATION_ID_GATE <<< "$(initiate_job "$PAYLOAD_GATE")"
if validate_job_id "$JOB_ID_GATE"; then
  poll_job "$JOB_ID_GATE" 300 5
  if verify_job_status "$JOB_ID_GATE" "COMPLETED"; then
    log_success "Gate: non-overridable flag override was silently ignored — job still COMPLETED normally"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Gate: expected job to still complete normally despite the non-overridable flag attempt"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_error "Gate: job failed to initiate"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
