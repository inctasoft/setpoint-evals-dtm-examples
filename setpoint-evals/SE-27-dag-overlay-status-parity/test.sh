#!/usr/bin/env bash
# SE-27: DAG overlay status-vocabulary parity (capability-spec.md §2d/§3.4/§4, Lane A
# backend scope only — see README "Scope note" for the 27.3/Playwright split with Lane B).
#
# 27.1: compile-time proof that WS StepStatus == @dtm/core's canonical 10-value
# StepStatus (via a throwaway .ts probe under services/orchestrator/src/, removed by
# trap), plus grep-level proof that the two known hand-duplicated declarations
# (packages/database Step entity, apps/monitor frontend event types) derive from
# @dtm/core instead of re-declaring it.
# 27.2: a skipped transition is broadcast LIVE over /ws/events, not just visible on the
# next on-demand snapshot — submits one fresh, fast (~5-10s) iot-sensor-pipeline job
# with ENABLE_ALERT_GENERATION=false.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-27: DAG overlay status-vocabulary parity (backend scope: 27.1 static + 27.2 live broadcast)"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"
command -v npx >/dev/null 2>&1 || se_skip "npx is required"
node -e "require('ws')" >/dev/null 2>&1 || se_skip "the 'ws' node module is not resolvable from ${ROOT}"

DTM_EVENT_TYPES="$ROOT/services/orchestrator/src/websocket/dtm-event.types.ts"
STEP_ENTITY="$ROOT/packages/database/src/entities/step.entity.ts"
MONITOR_EVENTS="$ROOT/apps/monitor/src/types/events.ts"
ORCH_DIR="$ROOT/services/orchestrator"
PROBE_FILE="$ORCH_DIR/src/__se27_probe.ts"

cleanup() { rm -f "$PROBE_FILE"; }
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════════════
# 27.1a. Compile-time parity: WS StepStatus == @dtm/core canonical StepStatus
# ═══════════════════════════════════════════════════════════════════════════
log_info "27.1a: building packages/core + packages/database so @dtm/core types resolve..."
( cd "$ROOT" && pnpm --filter "./packages/*" run build > /tmp/se27-packages-build.log 2>&1 )
BUILD_RC=$?
if [ "$BUILD_RC" -ne 0 ]; then
  se_skip "pnpm --filter ./packages/* run build failed (see /tmp/se27-packages-build.log) — cannot run the compile probe"
fi

cat > "$PROBE_FILE" << 'PROBE_EOF'
// SE-27 throwaway compile probe — written by test.sh, removed on exit. Never commit.
import type { StepStatus as WsStepStatus } from './websocket/dtm-event.types';
import type { StepStatus as CoreStepStatus } from '@dtm/core';

type Core = `${CoreStepStatus}`;
type MissingFromWs = Exclude<Core, WsStepStatus>;
type ExtraInWs = Exclude<WsStepStatus, Core>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _checkMissing: MissingFromWs extends never ? true : ['WS StepStatus is missing DB values', MissingFromWs] = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _checkExtra: ExtraInWs extends never ? true : ['WS StepStatus has ghost values not in DB', ExtraInWs] = true;
void _checkMissing;
void _checkExtra;
PROBE_EOF

( cd "$ORCH_DIR" && npx tsc --noEmit -p tsconfig.json > /tmp/se27-tsc-probe.log 2>&1 )
PROBE_ERRORS=$(grep -c "__se27_probe.ts" /tmp/se27-tsc-probe.log || true)
ck_eq "27.1a. compile probe: WS StepStatus has no missing/no ghost values vs @dtm/core (see /tmp/se27-tsc-probe.log)" "$PROBE_ERRORS" "0"

# ═══════════════════════════════════════════════════════════════════════════
# 27.1b-d. Grep-level proof the two hand-duplicated declarations now derive
# ═══════════════════════════════════════════════════════════════════════════
ck_file_has "27.1b. packages/database's Step entity imports StepStatus from @dtm/core" "$STEP_ENTITY" "StepStatus.*from ['\"]@dtm/core['\"]"
ck_absent "27.1c. packages/database's Step entity no longer hand-declares export enum StepStatus" "$STEP_ENTITY" "^export enum StepStatus"
ck_file_has "27.1d. apps/monitor/src/types/events.ts imports StepStatus from @dtm/core" "$MONITOR_EVENTS" "StepStatus.*from ['\"]@dtm/core['\"]"

# ═══════════════════════════════════════════════════════════════════════════
# 27.2. Live broadcast: skipped transition arrives as a WS event, not just on reconnect
# ═══════════════════════════════════════════════════════════════════════════
WS_PORT="${ORCHESTRATOR_PORT:-3002}"
WS_URL="ws://localhost:${WS_PORT}/ws/events"
API="${ORCHESTRATOR_HOST}/api/${API_VERSION}"

log_info "27.2: connecting to ${WS_URL}, submitting an alert-gated iot-sensor-pipeline job..."
CAPTURE=$(node "$HERE/watch-skip-broadcast.mjs" "$WS_URL" "$API" 30 2>/tmp/se27-watch.log)
WATCH_RC=$?

if [ "$WATCH_RC" -ne 0 ]; then
  log_warning "watch-skip-broadcast did not capture a step_skipped event within timeout (see /tmp/se27-watch.log)"
fi

CAPTURED_TYPE=$(echo "$CAPTURE" | jq -r '.captured.type // "none"' 2>/dev/null)
CAPTURED_STEP=$(echo "$CAPTURE" | jq -r '.captured.step // "none"' 2>/dev/null)
ck_eq "27.2. a step_skipped event is received live (not only via reconnect snapshot)" "$CAPTURED_TYPE" "step_skipped"
ck "27.2. the skipped step is one of the alert-gated steps (got: ${CAPTURED_STEP})" bash -c "[ '$CAPTURED_STEP' = 'EvaluateAlert' ] || [ '$CAPTURED_STEP' = 'DispatchAlert' ]"

se_summary
