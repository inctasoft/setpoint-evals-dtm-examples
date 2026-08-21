#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# SE: Happy Path — <YOUR WORKFLOW NAME>
#
# Verifies the basic end-to-end flow:
#   1. Initiate a job with a valid entity ID
#   2. All steps complete successfully
#   3. Job reaches COMPLETED status
#
# Replace entity IDs, step names, and assertions with your workflow's specifics.
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../shared/helpers.sh
source "${SCRIPT_DIR}/../shared/helpers.sh"

# ─── Test Configuration ──────────────────────────────────────────────────────

TEST_NAME="Happy Path"
ENTITY_ID="WIDGET-001"

# ─── Test Execution ──────────────────────────────────────────────────────────

display_eval_banner "${TEST_NAME}"

RESPONSE=$(initiate_job '{
  "workflowVariant": "default",
  "payload": {
    "entityId": "'"${ENTITY_ID}"'"
  }
}')

JOB_ID=$(echo "${RESPONSE}" | jq -r '.jobId')
log_info "Job initiated: ${JOB_ID}"

poll_job "${JOB_ID}" 120

verify_job_status "${JOB_ID}" "COMPLETED"
verify_step_status "${JOB_ID}" "FetchWidget" "COMPLETED"
verify_step_status "${JOB_ID}" "ProcessWidget" "COMPLETED"

# ─── Results ─────────────────────────────────────────────────────────────────

exit_with_summary
