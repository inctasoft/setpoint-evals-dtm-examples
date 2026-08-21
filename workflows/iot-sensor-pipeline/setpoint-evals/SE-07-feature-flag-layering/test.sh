#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# SE 07: Feature Flag Three-Layer Resolution
# ═══════════════════════════════════════════════════════════════════════════
# Drives the DOCUMENTED 3-layer priority for ENABLE_ALERT_GENERATION
# (default < env var < per-request, gated by clientOverridable) against the
# LIVE step-gating path:
#
#   Layer 1 (default): workflow.config.ts default is `true` -> alerts run.
#   Layer 2 (env var):  FEATURE_FLAG_ENABLE_ALERT_GENERATION=false set on
#     the orchestrator -> overrides the default -> alerts SKIPPED.
#   Layer 3 (per-request): payload.featureFlags.ENABLE_ALERT_GENERATION=true
#     with the env var STILL false -> per-request wins (ENABLE_ALERT_GENERATION
#     is in iot-sensor-pipeline's clientOverridable allowlist) -> alerts run
#     again.
#   GATE (clientOverridable enforcement): payload.featureFlags with a
#     NON-allowlisted key (ENABLE_CASCADE_FK_INJECTION) is ignored — the
#     request still completes normally and the orchestrator logs the
#     rejection.
#
# orchestration.service.ts's step-gating block ("1b. Feature gate") now
# calls FeatureFlagService.resolveFlags() — the single source of the
# 3-layer merge — instead of its own inline { ...defaultFlags, ...jobFlags }.
# See DIFFICULTIES-LOG.md (T1, Fixed) for the full history of this gap.
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
# GATE sub-test note: no step in iot-sensor-pipeline.workflow.config.ts uses
# ENABLE_CASCADE_FK_INJECTION as a featureGate (only ENABLE_ALERT_GENERATION
# is a featureGate, and it's allowlisted), so a non-allowlisted override
# attempt has no step-skip side effect to observe either way — "job still
# completes" alone would be vacuous (true regardless of enforcement). What
# IS real and enforcement-specific: FeatureFlagService.resolveFlags() logs
# `Feature flag "<key>" is not client-overridable — ignored` exactly when
# (and only when) it rejects a non-allowlisted key — this SE greps the
# orchestrator container's logs for that line, which only fires if the
# live code path actually executed the allowlist check. The companion unit
# test (feature-flag.service.spec.ts) additionally proves the REJECTED
# value itself never lands in the resolved output.
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
EVAL_PURPOSE="default < env var < per-request, gated by clientOverridable"

display_eval_banner "$EVAL_NAME" "$EVAL_PURPOSE"

if [ ! -f "$ENV_FILE" ]; then
  se_skip "no .env at repo root — cannot safely test the env-var layer without one"
fi

COMPOSE_PROJECT_NAME_VALUE="$(grep -m1 '^COMPOSE_PROJECT_NAME=' "$ENV_FILE" | cut -d= -f2)"
ORCHESTRATOR_CONTAINER="${COMPOSE_PROJECT_NAME_VALUE:-dtm}-orchestrator"

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
# GATE: ENABLE_CASCADE_FK_INJECTION is NOT in clientOverridable — override ignored
# ═══════════════════════════════════════════════════════════════════════════

log_section "GATE: non-allowlisted flag override has NO effect (enforced by resolveFlags())"

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
    log_success "Gate: non-overridable flag override was ignored — job still COMPLETED normally"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Gate: expected job to still complete normally despite the non-overridable flag attempt"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi

  # The step-skip path can't observe this rejection (ENABLE_CASCADE_FK_INJECTION
  # isn't any step's featureGate), so assert the enforcement DIRECTLY: the
  # orchestrator must have logged that it rejected the non-allowlisted key.
  if docker logs "$ORCHESTRATOR_CONTAINER" 2>&1 | \
      grep -q 'ENABLE_CASCADE_FK_INJECTION" is not client-overridable'; then
    log_success "Gate: orchestrator log confirms the allowlist check ran and rejected the override"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    log_error "Gate: expected orchestrator logs to contain the 'is not client-overridable' rejection for ENABLE_CASCADE_FK_INJECTION"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
else
  log_error "Gate: job failed to initiate"
  FAIL_COUNT=$((FAIL_COUNT + 2))
fi
echo ""

exit_with_summary "$PASS_COUNT" "$FAIL_COUNT"
