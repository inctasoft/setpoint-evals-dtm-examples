#!/usr/bin/env bash
# POST /api/v1/evals/:suite/:id/run degrades to a typed 422 — never a crash —
# for (a) THIS eval's own deliberately malformed README Payload JSON, and
# (b) an eval with no "## Payload" section at all (SE-14).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# se-lib: ck/ck_eq/ck_has (pipefail-safe, mutate counters — never call in $()), se_skip, se_summary.
# NOTE: this SE is FLAT under setpoint-evals/ (SE-01..SE-19 convention), so se-lib.sh is 2
# levels up (mirrors SE-14/SE-15's own path comment).
# shellcheck disable=SC1091
. "$HERE/../../scripts/se-lib.sh"
ROOT="$(cd "$HERE/../.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT/workflows/order-processing/setpoint-evals/shared/helpers.sh"

log_info "SE-18: malformed/missing Payload -> typed 422, not a crash"

# --- preflight ---------------------------------------------------------------
curl -s -o /dev/null -m 5 "${ORCHESTRATOR_HOST}/api/${API_VERSION}/health" \
  || se_skip "orchestrator is not reachable at ${ORCHESTRATOR_HOST}"

EVALS_API="${ORCHESTRATOR_HOST}/api/${API_VERSION}/evals"

# --- act: malformed JSON (THIS eval's own broken Payload fence) ----------------
RESP_MALFORMED=$(curl -s -w '\n%{http_code}' -m 10 -X POST \
  "${EVALS_API}/core/SE-18-evals-run-malformed-payload-422/run")
CODE_MALFORMED=$(echo "$RESP_MALFORMED" | tail -n1)
BODY_MALFORMED=$(echo "$RESP_MALFORMED" | sed '$d')

# --- act: no Payload section at all (SE-14) -----------------------------------
RESP_MISSING=$(curl -s -w '\n%{http_code}' -m 10 -X POST \
  "${EVALS_API}/core/SE-14-schema-single-source/run")
CODE_MISSING=$(echo "$RESP_MISSING" | tail -n1)
BODY_MISSING=$(echo "$RESP_MISSING" | sed '$d')

# --- assert (1:1 with the README checkbox list) ---------------------------------
ck_eq "POST /run on this eval (malformed JSON) returns HTTP 422" "$CODE_MALFORMED" "422"
ck_has "the 422 body mentions a parse/JSON error, not a generic message" \
  "$BODY_MALFORMED" "malformed"
ck_eq "POST /run on SE-14 (no Payload section at all) returns HTTP 422" "$CODE_MISSING" "422"
ck_has "the 422 body mentions there is nothing to run" "$BODY_MISSING" "nothing to run"
ck_absent "neither response body carries a jobId (no job created)" <(echo "$BODY_MALFORMED"; echo "$BODY_MISSING") '"jobId"'

se_summary
