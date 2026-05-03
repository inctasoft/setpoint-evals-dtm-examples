#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# <YOUR WORKFLOW NAME> — SE Helpers
#
# Workflow-specific layer that extends the generic SE helpers.
# Add workflow-specific helper functions, test data utilities, etc.
# ═══════════════════════════════════════════════════════════════════════════════

# Source the generic SE helpers
WORKFLOW_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${WORKFLOW_HELPERS_DIR}/../../../.." && pwd)"

# shellcheck source=../../../../setpoint-evals/shared/helpers.sh
source "${REPO_ROOT}/setpoint-evals/shared/helpers.sh"

# ─── Workflow Configuration ──────────────────────────────────────────────────

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:3002}"

# ─── Workflow-Specific Helpers ───────────────────────────────────────────────

# Add your workflow-specific helper functions below.
# Examples:
#   - Custom initiation wrappers
#   - Domain-specific status display
#   - Test data generators

validate_env_for_ste() {
  if ! curl -s "${ORCHESTRATOR_URL}/health" > /dev/null 2>&1; then
    log_error "Orchestrator not reachable at ${ORCHESTRATOR_URL}"
    exit 1
  fi
  log_info "Environment validated for SE execution"
}
