#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# Infra Provisioning Workflow — STE Helpers (Workflow Layer)
# ═══════════════════════════════════════════════════════════════════════════
# Workflow-specific functions for infra-provisioning STEs.
# Chains to the generic STE helpers for core functionality.
#
# Usage from workflow STEs:
#   source "${SCRIPT_DIR}/../shared/helpers.sh"
#
# This file adds:
#   - Infra-provisioning-specific API functions (initiate_job, get_job_status)
#   - Workflow endpoint configuration (generic workflow API)
#   - Infra-provisioning test data defaults (ENTITY_ID, VARIANT)
#   - Polling with step-specific status display
#
# ═══════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════
# Source Generic Helpers
# ═══════════════════════════════════════════════════════════════════════════

# Compute repo root from this file's location (4 levels up from workflows/infra-provisioning/ste/shared/)
WORKFLOW_STE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
_WORKFLOW_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"

# Source the generic helpers (this sets REPO_ROOT, EVAL_ROOT_DIR, colors, logging, etc.)
source "${_WORKFLOW_REPO_ROOT}/ste/shared/helpers.sh"

# ═══════════════════════════════════════════════════════════════════════════
# Workflow-Specific Configuration
# ═══════════════════════════════════════════════════════════════════════════

ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-http://localhost:${ORCHESTRATOR_PORT_HOST:-3002}/api/v1}"
WORKFLOW_NAME="infra-provisioning"

# ═══════════════════════════════════════════════════════════════════════════
# Helper: Initiate an infra-provisioning job
# ═══════════════════════════════════════════════════════════════════════════
# POSTs to $ORCHESTRATOR_URL/workflows/infra-provisioning/jobs
# Usage: initiate_job '{"payload": {"environmentId": "ENV-DEV"}, ...}'
# Returns: "jobId:correlationId" on stdout
#
initiate_job() {
  local payload="$1"
  local endpoint_url="${ORCHESTRATOR_URL}/workflows/${WORKFLOW_NAME}/jobs"

  log_step "Initiating ${WORKFLOW_NAME} job..." >&2
  log_info "Endpoint: ${endpoint_url}" >&2

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
    echo "Response:" >&2
    echo "$response" | jq '.' 2>/dev/null || echo "$response" >&2
    echo "" >&2
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

  # Return "jobId:correlationId" so caller can split with IFS=':'
  echo "${job_id}:${correlation_id}"
}

# ═══════════════════════════════════════════════════════════════════════════
# Helper: Get job status
# ═══════════════════════════════════════════════════════════════════════════
# GETs $ORCHESTRATOR_URL/jobs/${jobId}
# Usage: get_job_status "$JOB_ID"
# Returns: Full JSON response
#
get_job_status() {
  local job_id="$1"
  local max_retries=3
  local retry=0
  while [ $retry -lt $max_retries ]; do
    local response
    if response=$(curl -s --max-time 10 "${ORCHESTRATOR_URL}/jobs/${job_id}" 2>/dev/null) && [ -n "$response" ]; then
      echo "$response"
      return 0
    fi
    retry=$((retry + 1))
    [ $retry -lt $max_retries ] && sleep 2
  done
  echo "{}"
}

# ═══════════════════════════════════════════════════════════════════════════
# Helper: Poll job until terminal state or timeout
# ═══════════════════════════════════════════════════════════════════════════
# Usage: poll_job "$JOB_ID" [MAX_SECONDS] [INTERVAL_SECONDS]
#
poll_job() {
  local job_id="$1"
  local max_seconds="${2:-60}"
  local interval="${3:-3}"
  local max_polls=$((max_seconds / interval))

  if [ -n "$ADDITIONAL_TIMEOUT" ] && [ "$ADDITIONAL_TIMEOUT" -gt 0 ]; then
    local additional_polls=$((ADDITIONAL_TIMEOUT / interval))
    max_polls=$((max_polls + additional_polls))
    log_info "Increasing max polls to ${max_polls} due to --add-timeout=${ADDITIONAL_TIMEOUT}"
  fi

  log_step "Polling job status (max ${max_seconds}s, interval ${interval}s)..."
  echo ""

  local poll_count=0

  while [ $poll_count -lt $max_polls ]; do
    sleep "$interval"
    poll_count=$((poll_count + 1))

    local status_response
    status_response=$(get_job_status "$job_id")

    local job_status
    job_status=$(extract_job_status "$status_response")

    # Extract key step statuses for display
    local pe_status=$(extract_step_status "$status_response" "PlanEnvironment" || echo "PENDING")
    local ae_status=$(extract_step_status "$status_response" "ApplyEnvironment" || echo "PENDING")
    local pn_status=$(extract_step_status "$status_response" "PlanNetwork" || echo "PENDING")
    local an_status=$(extract_step_status "$status_response" "ApplyNetwork" || echo "PENDING")
    local dc_status=$(extract_step_status "$status_response" "DiscoverCompute" || echo "PENDING")

    echo -e "[${poll_count}/${max_polls}] Job: ${CYAN}${job_status}${NC} | PE=${pe_status} AE=${ae_status} PN=${pn_status} AN=${an_status} DC=${dc_status}"

    # Check for terminal states (case-insensitive)
    if [[ "${job_status,,}" == "completed" ]] || \
       [[ "${job_status,,}" == "failed" ]] || \
       [[ "${job_status,,}" == "partial_success" ]]; then
      echo ""
      log_success "Job finished with status: ${job_status}"
      return 0
    fi
  done

  echo ""
  log_warning "Polling timed out after ${max_polls} attempts (${max_seconds}s)"
  return 1
}

# ═══════════════════════════════════════════════════════════════════════════
# Helper: Display final job results
# ═══════════════════════════════════════════════════════════════════════════
# Usage: display_results "$JOB_ID"
#
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

# ═══════════════════════════════════════════════════════════════════════════
# Helper: Display eval banner
# ═══════════════════════════════════════════════════════════════════════════
# Usage: display_eval_banner "Test Name" "Purpose description"
#
display_eval_banner() {
  local eval_name="$1"
  local eval_purpose="${2:-}"

  echo ""
  echo -e "${CYAN}======================================================================${NC}"
  echo -e "${CYAN}  ${eval_name}${NC}"
  if [ -n "$eval_purpose" ]; then
    echo -e "${CYAN}  ${eval_purpose}${NC}"
  fi
  echo -e "${CYAN}======================================================================${NC}"
  echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# Helper: Validate job ID (UUID format)
# ═══════════════════════════════════════════════════════════════════════════
# Usage: validate_job_id "$JOB_ID"
#
validate_job_id() {
  local job_id="$1"

  if [ -z "$job_id" ]; then
    log_error "JOB_ID is empty!" >&2
    return 1
  fi

  # Strip any trailing correlationId after ':'
  job_id="${job_id%%:*}"

  if ! [[ "$job_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    log_error "JOB_ID is not a valid UUID: '$job_id'" >&2
    return 1
  fi

  return 0
}

# ═══════════════════════════════════════════════════════════════════════════
# Environment Validation (Workflow Override)
# ═══════════════════════════════════════════════════════════════════════════

validate_env_for_ste() {
  log_info "Validating environment for infra-provisioning STEs..."

  local validation_failed=false

  # Check orchestrator is reachable
  if ! curl -s -f "${ORCHESTRATOR_URL}/health" > /dev/null 2>&1; then
    # Try base URL without path
    local base_url="${ORCHESTRATOR_URL%/api/v1}"
    if ! curl -s -f "${base_url}/health" > /dev/null 2>&1; then
      log_error "Orchestrator not reachable at ${ORCHESTRATOR_URL}"
      validation_failed=true
    fi
  fi

  # Check infra-provisioning source database container is running
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q "dtm-infra-provisioning-source-db"; then
    log_warning "Infra-provisioning source database container is NOT running"
    log_warning "  Fix: docker compose -f workflows/infra-provisioning/docker-compose.infra-provisioning.yml up -d"
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
