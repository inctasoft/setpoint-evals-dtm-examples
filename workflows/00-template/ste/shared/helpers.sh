#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# <YOUR WORKFLOW NAME> — STE Helpers
#
# Workflow-specific layer that extends the generic STE helpers.
# Add workflow-specific helper functions, test data utilities, etc.
# ═══════════════════════════════════════════════════════════════════════════════

# Source the generic STE helpers
WORKFLOW_HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${WORKFLOW_HELPERS_DIR}/../../../.." && pwd)"

# shellcheck source=../../../../ste/shared/helpers.sh
source "${REPO_ROOT}/ste/shared/helpers.sh"

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
  log_info "Environment validated for STE execution"
}
