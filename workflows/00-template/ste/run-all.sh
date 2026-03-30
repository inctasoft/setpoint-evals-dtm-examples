#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# <YOUR WORKFLOW NAME> — Run All Workflow STEs
#
# Usage:
#   ./workflows/00-template/ste/run-all.sh             # Run all workflow STEs
#   ./workflows/00-template/ste/run-all.sh --parallel   # Run safe tests in parallel
#   ./workflows/00-template/ste/run-all.sh --in-band    # Run all sequentially
#   ./workflows/00-template/ste/run-all.sh --skip-purge # Skip initial data purge
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/shared/helpers.sh"

# ─── Configuration ───────────────────────────────────────────────────────────

PARALLEL_SAFE=(
  "01-happy-path"
)

SEQUENTIAL_ONLY=()

# ─── Argument Parsing ────────────────────────────────────────────────────────

MODE="parallel"
SKIP_PURGE=false

for arg in "$@"; do
  case "${arg}" in
    --parallel)   MODE="parallel" ;;
    --in-band)    MODE="sequential" ;;
    --skip-purge) SKIP_PURGE=true ;;
  esac
done

# ─── Execution ───────────────────────────────────────────────────────────────

validate_env_for_ste

PASSED=0
FAILED=0
SKIPPED=0

run_test() {
  local test_dir="$1"
  local test_name
  test_name=$(basename "${test_dir}")

  if [[ -f "${SCRIPT_DIR}/${test_dir}/test.sh" ]]; then
    log_info "Running: ${test_name}"
    if bash "${SCRIPT_DIR}/${test_dir}/test.sh"; then
      ((PASSED++))
    else
      ((FAILED++))
    fi
  else
    log_warn "No test.sh found in ${test_dir}"
    ((SKIPPED++))
  fi
}

for test in "${PARALLEL_SAFE[@]}" "${SEQUENTIAL_ONLY[@]}"; do
  run_test "${test}"
done

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Results: ${PASSED} passed, ${FAILED} failed, ${SKIPPED} skipped"
echo "════════════════════════════════════════════════════════"

[[ ${FAILED} -eq 0 ]] && exit 0 || exit 1
