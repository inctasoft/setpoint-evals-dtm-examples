#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# DTM Core — SE Shared Helpers (Generic Layer)
# ═══════════════════════════════════════════════════════════════════════════
# Generic functions for Setpoint Evals (SEs).
# These work with any workflow loaded by the DTM engine.
#
# Usage from core SEs:
#   source "${SCRIPT_DIR}/../shared/helpers.sh"
#
# Usage from workflow SEs (via chaining):
#   Workflow helpers source this file, then add workflow-specific functions.
#
# Function Reference:
#   Job Lifecycle:
#     initiate_job "$PAYLOAD" "$ENDPOINT_URL"  → Returns "jobId:correlationId"
#     get_job_status "$JOB_ID"                 → Returns full JSON response
#     poll_job "$JOB_ID" [MAX_POLLS] [INTERVAL]
#
#   Verification:
#     verify_job_status "$JOB_ID" "completed"
#     verify_step_status "$JOB_ID" "StepName" "completed"
#     validate_job_id "$JOB_ID"
#
#   Extraction (from JSON response):
#     extract_job_status "$JSON_RESPONSE"
#     extract_step_status "$JSON_RESPONSE" "StepName"
#
#   Logging:
#     log_info, log_success, log_error, log_warning, log_step
#     log_header, log_section, display_eval_banner
#
#   Display:
#     display_results "$JOB_ID"
#     exit_with_summary PASS_COUNT FAIL_COUNT
#
# ═══════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
# Load Environment Variables from .env file
# ═══════════════════════════════════════════════════════════════════════════

# Determine the repository root (2 levels up from setpoint-evals/shared/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Also set EVAL_ROOT_DIR for backward compatibility
EVAL_ROOT_DIR="$REPO_ROOT"

# Load from .env.local for SEs (they run from host, not Docker)
# Fall back to .env if .env.local doesn't exist
# See .env.local.example for the template with host-mapped ports
if [ -f "${REPO_ROOT}/.env.local" ]; then
  ENV_FILE="${REPO_ROOT}/.env.local"
elif [ -f "${REPO_ROOT}/.env" ]; then
  ENV_FILE="${REPO_ROOT}/.env"
else
  ENV_FILE=""
fi

if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    [[ $key =~ ^[[:space:]]*# ]] && continue
    [[ -z $key ]] && continue
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//')
    export "$key=$value"
  done < <(grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$')
fi

# ═══════════════════════════════════════════════════════════════════════════
# Colors
# ═══════════════════════════════════════════════════════════════════════════

if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
  export RED=''
  export GREEN=''
  export YELLOW=''
  export BLUE=''
  export CYAN=''
  export MAGENTA=''
  export NC=''
else
  export RED='\033[0;31m'
  export GREEN='\033[0;32m'
  export YELLOW='\033[1;33m'
  export BLUE='\033[0;34m'
  export CYAN='\033[0;36m'
  export MAGENTA='\033[0;35m'
  export NC='\033[0m'
fi

# ═══════════════════════════════════════════════════════════════════════════
# Utility Functions
# ═══════════════════════════════════════════════════════════════════════════

strip_ansi_codes() {
  sed 's/\x1b\[[0-9;]*m//g'
}

# ═══════════════════════════════════════════════════════════════════════════
# SE Conventions v2 (server-config/docs/setpoint-eval-conventions.md)
# ═══════════════════════════════════════════════════════════════════════════

# exit-77 SKIP sentinel — run-all.sh treats exit 77 as SKIP (not FAIL), across every
# execution mode (parallel/destructive/in-band). Use when an SE can't meaningfully run
# in the current environment (missing optional dependency, etc.) — never as a way to
# silence a real failure.
se_skip() {
  log_warning "SKIP: ${1:-no reason given}" >&2
  exit 77
}

# --quick opt-in helper. An SE that declares '**Quick**: yes' in its README may wrap a
# delay literal with this to zero it when SE_QUICK=1 (exported by `run-all.sh --quick`):
#   "ackDelay": $(qdelay 5000)
# No SE in this repo currently opts in — SE_QUICK is exported and ready, this is the
# hook future SEs use; today --quick is a functional no-op here.
qdelay() {
  if [ "${SE_QUICK:-0}" = "1" ]; then echo 0; else echo "${1:-0}"; fi
}

# ═══════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════

export ORCHESTRATOR_PORT="${ORCHESTRATOR_PORT:-3002}"
export ORCHESTRATOR_BASE_URL="${ORCHESTRATOR_BASE_URL:-http://localhost:${ORCHESTRATOR_PORT}}"
export ORCHESTRATOR_API_BASE_PATH="${ORCHESTRATOR_API_BASE_PATH:-/api/v1}"
export API_BASE_URL="${API_BASE_URL:-${ORCHESTRATOR_BASE_URL}${ORCHESTRATOR_API_BASE_PATH}}"

# Backward-compat aliases
export ORCHESTRATOR_HOST="${ORCHESTRATOR_HOST:-${ORCHESTRATOR_BASE_URL}}"
export API_VERSION="${API_VERSION:-v1}"

# ═══════════════════════════════════════════════════════════════════════════
# Logging Functions
# ═══════════════════════════════════════════════════════════════════════════

log_info() {
  echo -e "${CYAN}ℹ️  $1${NC}"
}

log_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
  echo -e "${RED}❌ $1${NC}"
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

log_step() {
  echo -e "${BLUE}▶  $1${NC}"
}

log_header() {
  echo ""
  echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║ $(printf '%-66s' "$1") ║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

log_section() {
  echo ""
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
  echo -e "${CYAN}$1${NC}"
  echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════${NC}"
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# Environment Validation
# ═══════════════════════════════════════════════════════════════════════════

validate_env_for_ste() {
  log_info "Validating environment for SE execution..."

  local validation_failed=false

  # Check orchestrator container is running
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-orchestrator"; then
    log_error "Orchestrator container is NOT running"
    validation_failed=true
  fi

  # Check database container is running
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "${COMPOSE_PROJECT_NAME:-dtm}-db"; then
    log_error "Database container is NOT running"
    validation_failed=true
  fi

  if [[ "$validation_failed" == "true" ]]; then
    echo ""
    log_error "Environment validation FAILED"
    return 1
  else
    log_success "Environment validation passed"
    return 0
  fi
}

check_env_var() {
  local var_name="$1"
  local expected="$2"
  local error_msg="$3"
  local var_value="${!var_name}"

  if [[ -z "$var_value" ]]; then
    log_error "${var_name} is not set"
    if [[ -n "$error_msg" ]]; then
      log_error "  ${error_msg}"
    fi
    return 1
  elif [[ -n "$expected" && "$var_value" != "$expected" ]]; then
    log_warning "${var_name}=${var_value} (expected: ${expected})"
    if [[ -n "$error_msg" ]]; then
      log_warning "  ${error_msg}"
    fi
    return 1
  else
    return 0
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# API Helper Functions
# ═══════════════════════════════════════════════════════════════════════════

# Initiate a job with JSON payload
# Usage: initiate_job '{"key": "value", ...}' [endpoint_url]
# Returns: "jobId\ncorrelationId" on stdout (use IFS=':' read -r JOB_ID CORRELATION_ID)
initiate_job() {
  local payload="$1"
  local endpoint_url="${2:-${API_BASE_URL}/jobs}"

  log_step "Initiating job..." >&2

  local temp_headers
  temp_headers=$(mktemp)
  local response_with_code
  response_with_code=$(curl -s -w "\n%{http_code}" -D "$temp_headers" -X POST "$endpoint_url" \
    -H "Content-Type: application/json" \
    -d "$payload")

  local http_code
  http_code=$(echo "$response_with_code" | tail -n1)
  local response
  response=$(echo "$response_with_code" | head -n-1)

  local correlation_id
  correlation_id=$(grep -i "^X-Correlation-ID:" "$temp_headers" | cut -d' ' -f2 | tr -d '\r\n' || echo "")
  rm -f "$temp_headers"

  if [ "$http_code" != "201" ]; then
    log_error "Job request failed with HTTP $http_code" >&2
    echo "" >&2

    if [ "$http_code" = "409" ]; then
      log_error "DEDUPLICATION CONFLICT DETECTED!" >&2
      log_error "   The orchestrator rejected this request as a duplicate." >&2
      echo "" >&2
      log_info "Response body:" >&2
      echo "$response" | jq '.' 2>/dev/null || echo "$response" >&2
      echo "" >&2
      log_warning "This should NOT happen if enableDeduplication: false is set!" >&2
      log_warning "   Possible causes:" >&2
      echo "      1. Database not purged (old job still exists)" >&2
      echo "      2. TypeORM cache has stale data" >&2
      echo "      3. enableDeduplication flag not passed correctly" >&2
      echo "      4. Orchestrator not respecting the flag" >&2
      echo "" >&2
    else
      echo "Response:" >&2
      echo "$response" | jq '.' 2>/dev/null || echo "$response" >&2
      echo "" >&2
    fi

    return 1
  fi

  local job_id
  job_id=$(echo "$response" | grep -o '"jobId":"[^"]*"' | cut -d'"' -f4)

  if [ -z "$job_id" ]; then
    log_error "Failed to extract jobId from response" >&2
    echo "Response:" >&2
    echo "$response" | jq '.' 2>/dev/null || echo "$response" >&2
    echo "" >&2
    return 1
  fi

  if ! [[ "$job_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    log_error "Extracted jobId is not a valid UUID: '$job_id'" >&2
    return 1
  fi

  log_success "Job initiated!" >&2
  log_info "Job ID: ${CYAN}${job_id}${NC}" >&2
  if [ -n "$correlation_id" ]; then
    log_info "Correlation ID: ${MAGENTA}${correlation_id}${NC}" >&2
  fi
  log_info "HTTP Status: ${GREEN}${http_code}${NC}" >&2
  echo "" >&2

  echo "$job_id"
  echo "$correlation_id"
}

validate_job_id() {
  local job_id="$1"

  if [ -z "$job_id" ]; then
    log_error "JOB_ID is empty!" >&2
    log_error "  This means initiate_job() failed but didn't stop the test." >&2
    log_error "  Always check the return code: JOB_ID=\$(initiate_job \"\$PAYLOAD\") || exit 1" >&2
    return 1
  fi

  if ! [[ "$job_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    log_error "JOB_ID is not a valid UUID: '$job_id'" >&2
    return 1
  fi

  return 0
}

# Get job status
# Usage: get_job_status "$JOB_ID" [base_path]
get_job_status() {
  local job_id="$1"
  local base_path="${2:-${API_BASE_URL}/migrations}"
  curl -s "${base_path}/${job_id}"
}

get_job_details() {
  get_job_status "$@"
}

extract_job_status() {
  echo "$1" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4
}

extract_step_status() {
  local json="$1"
  local step_name="$2"

  if command -v jq &> /dev/null; then
    echo "$json" | jq -r "[.steps[] | select(.stepNumber == \"${step_name}\") | .status] | first" 2>/dev/null || echo ""
  else
    echo "$json" | grep -A10 "\"stepNumber\":\"${step_name}\"" | grep '"status"' | head -1 | cut -d'"' -f4
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# Monitoring Functions
# ═══════════════════════════════════════════════════════════════════════════

# Poll job until completion or timeout
# Usage: poll_job "$JOB_ID" [MAX_POLLS] [POLL_INTERVAL]
poll_job() {
  local job_id="$1"
  local max_polls="${2:-50}"
  local poll_interval="${3:-3}"

  if [ -n "$ADDITIONAL_TIMEOUT" ] && [ "$ADDITIONAL_TIMEOUT" -gt 0 ]; then
    local additional_polls=$((ADDITIONAL_TIMEOUT / poll_interval))
    max_polls=$((max_polls + additional_polls))
    log_info "Increasing max polls to ${max_polls} due to --add-timeout=${ADDITIONAL_TIMEOUT}"
  fi

  log_step "Monitoring job progress..."
  echo ""

  local poll_count=0

  while [ $poll_count -lt $max_polls ]; do
    sleep "$poll_interval"
    poll_count=$((poll_count + 1))

    local status_response
    status_response=$(get_job_status "$job_id")

    local job_status
    job_status=$(extract_job_status "$status_response")

    echo -e "[${poll_count}/${max_polls}] Job: ${CYAN}${job_status}${NC}"

    if [[ "${job_status,,}" == "completed" ]] || [[ "${job_status,,}" == "failed" ]]; then
      echo ""
      log_success "Job finished!"
      return 0
    fi
  done

  echo ""
  log_warning "Polling timed out after ${max_polls} attempts"
  return 1
}

# ═══════════════════════════════════════════════════════════════════════════
# Verification Functions
# ═══════════════════════════════════════════════════════════════════════════

verify_job_status() {
  local job_id="$1"
  local expected_status="$2"

  local status_response
  status_response=$(get_job_status "$job_id")

  local actual_status
  actual_status=$(extract_job_status "$status_response")

  if [[ "${actual_status,,}" == "${expected_status,,}" ]]; then
    log_success "Job status verification PASSED: ${expected_status}"
    return 0
  else
    log_error "Job status verification FAILED: Expected ${expected_status}, got ${actual_status}"
    return 1
  fi
}

verify_step_status() {
  local job_id="$1"
  local step_name="$2"
  local expected_status="$3"

  local status_response
  status_response=$(get_job_status "$job_id")

  local actual_status
  actual_status=$(extract_step_status "$status_response" "$step_name")

  if [[ "${actual_status,,}" == "${expected_status,,}" ]]; then
    log_success "Step ${step_name} verification PASSED: ${expected_status}"
    return 0
  else
    log_error "Step ${step_name} verification FAILED: Expected ${expected_status}, got ${actual_status}"
    return 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# Display Functions
# ═══════════════════════════════════════════════════════════════════════════

display_results() {
  local job_id="$1"

  log_section "FINAL RESULTS"

  local status_response
  status_response=$(get_job_status "$job_id")

  if command -v jq &> /dev/null; then
    echo "$status_response" | jq '.'
  else
    echo "$status_response"
  fi

  echo ""
}

display_eval_banner() {
  local eval_name="$1"
  local eval_purpose="${2:-}"

  echo ""
  echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║$(printf '%*s' $(((68+${#eval_name})/2)) "$eval_name")$(printf '%*s' $(((68-${#eval_name})/2)) "")║${NC}"
  echo -e "${CYAN}╠════════════════════════════════════════════════════════════════════╣${NC}"
  echo -e "${CYAN}║ $(printf '%-66s' "$eval_purpose") ║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# Test Utilities
# ═══════════════════════════════════════════════════════════════════════════

run_test() {
  local test_name="$1"
  local test_function="$2"

  log_step "Running: ${test_name}"

  if $test_function; then
    log_success "${test_name} PASSED"
    return 0
  else
    log_error "${test_name} FAILED"
    return 1
  fi
}

exit_with_summary() {
  local pass_count="$1"
  local fail_count="$2"
  local total=$((pass_count + fail_count))

  echo ""
  log_section "TEST SUMMARY"

  echo -e "Total Tests:  ${CYAN}${total}${NC}"
  echo -e "Passed:       ${GREEN}${pass_count}${NC}"
  echo -e "Failed:       ${RED}${fail_count}${NC}"
  echo ""

  if [ "$fail_count" -eq 0 ]; then
    log_success "ALL TESTS PASSED!"
    exit 0
  else
    log_error "SOME TESTS FAILED"
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# Step Completion Retry Helpers (for race condition handling)
# ═══════════════════════════════════════════════════════════════════════════

wait_for_steps_completed() {
  local job_id="$1"
  local step_type="$2"
  local expected_count="$3"
  local max_attempts="${4:-15}"
  local interval="${5:-1}"

  local attempt=0
  local job_details
  local actual_count

  while [ $attempt -lt $max_attempts ]; do
    attempt=$((attempt + 1))

    job_details=$(get_job_status "$job_id")
    actual_count=$(echo "$job_details" | jq "[.steps[] | select(.stepNumber == \"$step_type\" and .status == \"completed\")] | length")

    if [ "$actual_count" -ge "$expected_count" ]; then
      echo "$job_details"
      return 0
    fi

    if [ $attempt -lt $max_attempts ]; then
      log_info "Attempt $attempt/$max_attempts: $step_type steps completing ($actual_count/$expected_count)..." >&2
      sleep "$interval"
    fi
  done

  log_warning "Timeout waiting for $step_type steps: $actual_count/$expected_count after $max_attempts attempts" >&2
  echo "$job_details"
  return 1
}

wait_for_job_stats() {
  local job_id="$1"
  local expected_steps="$2"
  local expected_records="$3"
  local max_attempts="${4:-15}"
  local interval="${5:-1}"

  local attempt=0
  local job_details
  local actual_steps
  local actual_records

  while [ $attempt -lt $max_attempts ]; do
    attempt=$((attempt + 1))

    job_details=$(get_job_status "$job_id")
    actual_steps=$(echo "$job_details" | jq -r '.result.stepsCompleted // 0')
    actual_records=$(echo "$job_details" | jq -r '.result.totalRecords // 0')

    if [ "$actual_steps" -ge "$expected_steps" ] && [ "$actual_records" -ge "$expected_records" ]; then
      echo "$job_details"
      return 0
    fi

    if [ $attempt -lt $max_attempts ]; then
      log_info "Attempt $attempt/$max_attempts: Job stats syncing (steps: $actual_steps/$expected_steps, records: $actual_records/$expected_records)..." >&2
      sleep "$interval"
    fi
  done

  log_warning "Timeout waiting for job stats: steps=$actual_steps/$expected_steps, records=$actual_records/$expected_records after $max_attempts attempts" >&2
  echo "$job_details"
  return 1
}

# ═══════════════════════════════════════════════════════════════════════════
# Backward Compatibility Aliases
# ═══════════════════════════════════════════════════════════════════════════
# These aliases allow existing test scripts to work without modification.
# They will be removed in a future cleanup phase.

initiate_migration() { initiate_job "$@"; }
get_migration_status() { get_job_status "$@"; }
get_migration_job_details() { get_job_details "$@"; }
poll_migration() { poll_job "$@"; }
validate_env_for_e2e() { validate_env_for_ste "$@"; }
