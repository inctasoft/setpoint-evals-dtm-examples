#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# API Configuration for DTM Scripts
# ═══════════════════════════════════════════════════════════════════════════
# Centralized API endpoint configuration shared between monitor scripts and
# E2E tests. Aligned with e2e-evals/shared/helpers.sh configuration.
#
# Usage:
#   source "$(dirname "$0")/inc/api-config.sh"  # From scripts/ directory
#   source "$(dirname "$0")/../inc/api-config.sh"  # From scripts subdirectories
#
# Environment Variables (all optional, with sensible defaults):
#   ORCHESTRATOR_BASE_URL       - Base host URL (default: http://localhost:3002)
#   ORCHESTRATOR_API_BASE_PATH  - API base path (default: /api/v1)
#   ORCHESTRATOR_PORT           - Override port only (default: 3002)
#
# Exported Variables (aligned with E2E helpers):
#   ORCHESTRATOR_BASE_URL       - Base host (e.g., http://localhost:3002)
#   ORCHESTRATOR_API_BASE_PATH  - API base path (e.g., /api/v1)
#   API_BASE_URL                - Full API URL (e.g., http://localhost:3002/api/v1)
#
# Legacy Variables (deprecated, for backward compatibility):
#   ORCHESTRATOR_HOST           - Use ORCHESTRATOR_BASE_URL instead
#   API_VERSION                 - Use ORCHESTRATOR_API_BASE_PATH instead
#   ORCHESTRATOR_URL            - Use ORCHESTRATOR_BASE_URL instead

# ═══════════════════════════════════════════════════════════════════════════
# Configuration (Aligned with E2E Helpers)
# ═══════════════════════════════════════════════════════════════════════════

# Default orchestrator base URL (can be overridden via environment)
export ORCHESTRATOR_BASE_URL="${ORCHESTRATOR_BASE_URL:-http://localhost:${ORCHESTRATOR_PORT:-3002}}"

# API base path (configurable for testing different API versions)
export ORCHESTRATOR_API_BASE_PATH="${ORCHESTRATOR_API_BASE_PATH:-/api/v1}"

# Construct full API URL
export API_BASE_URL="${ORCHESTRATOR_BASE_URL}${ORCHESTRATOR_API_BASE_PATH}"

# ═══════════════════════════════════════════════════════════════════════════
# Legacy Compatibility (Deprecated)
# ═══════════════════════════════════════════════════════════════════════════

# Support old variable names for backward compatibility
export ORCHESTRATOR_HOST="${ORCHESTRATOR_HOST:-${ORCHESTRATOR_BASE_URL}}"
export ORCHESTRATOR_URL="${ORCHESTRATOR_URL:-${ORCHESTRATOR_BASE_URL}}"
export API_VERSION="${API_VERSION:-v1}"

# ═══════════════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════════════

# Get API endpoint URL
# Usage: get_api_url "/workflows/order-processing/jobs"
get_api_url() {
    local endpoint="$1"
    # Remove leading slash if present
    endpoint="${endpoint#/}"
    echo "${API_BASE_URL}/${endpoint}"
}

# Get non-versioned endpoint URL (for health checks, etc.)
# Usage: get_base_url "/health"
get_base_url() {
    local endpoint="$1"
    # Remove leading slash if present
    endpoint="${endpoint#/}"
    echo "${ORCHESTRATOR_BASE_URL}/${endpoint}"
}

# Display current API configuration
display_api_config() {
    if [ -n "${GREEN:-}" ]; then
        echo -e "${CYAN}📡 API Configuration:${NC}"
        echo -e "  ${BOLD}Base URL:${NC}        ${ORCHESTRATOR_BASE_URL}"
        echo -e "  ${BOLD}API Path:${NC}        ${ORCHESTRATOR_API_BASE_PATH}"
        echo -e "  ${BOLD}Full API URL:${NC}    ${API_BASE_URL}"
    else
        echo "📡 API Configuration:"
        echo "  Base URL:        ${ORCHESTRATOR_BASE_URL}"
        echo "  API Path:        ${ORCHESTRATOR_API_BASE_PATH}"
        echo "  Full API URL:    ${API_BASE_URL}"
    fi
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# Validation
# ═══════════════════════════════════════════════════════════════════════════

# Validate API configuration
validate_api_config() {
    local errors=0
    
    if [ -z "$ORCHESTRATOR_BASE_URL" ]; then
        echo "❌ ORCHESTRATOR_BASE_URL is not set" >&2
        errors=$((errors + 1))
    fi
    
    if [ -z "$ORCHESTRATOR_API_BASE_PATH" ]; then
        echo "❌ ORCHESTRATOR_API_BASE_PATH is not set" >&2
        errors=$((errors + 1))
    fi
    
    if [ -z "$API_BASE_URL" ]; then
        echo "❌ API_BASE_URL is not set" >&2
        errors=$((errors + 1))
    fi
    
    if [ $errors -gt 0 ]; then
        return 1
    fi
    
    return 0
}

# ═══════════════════════════════════════════════════════════════════════════
# Examples
# ═══════════════════════════════════════════════════════════════════════════
#
# Test against default API (http://localhost:3002/api/v1):
#   ./scripts/monitor-jobs-api.sh
#
# Test against API v2 (when available):
#   ORCHESTRATOR_API_BASE_PATH=/api/v2 ./scripts/monitor-jobs-api.sh
#
# Test against staging environment:
#   ORCHESTRATOR_BASE_URL=https://staging.example.com ./scripts/monitor-jobs-api.sh
#
# Test against custom environment and API version:
#   ORCHESTRATOR_BASE_URL=https://qa.example.com \
#   ORCHESTRATOR_API_BASE_PATH=/api/v2 \
#   ./scripts/monitor-jobs-api.sh
#
# Or export for all subsequent commands:
#   export ORCHESTRATOR_BASE_URL=http://localhost:3002
#   export ORCHESTRATOR_API_BASE_PATH=/api/v1
#   ./scripts/monitor-jobs-api.sh
#   ./scripts/monitor-events-api.sh
#
# ═══════════════════════════════════════════════════════════════════════════
# Alignment with E2E Helpers
# ═══════════════════════════════════════════════════════════════════════════
#
# This configuration is now aligned with e2e-evals/shared/helpers.sh:
#   - Both use ORCHESTRATOR_BASE_URL (default: http://localhost:3002)
#   - Both use ORCHESTRATOR_API_BASE_PATH (default: /api/v1)
#   - Both construct API_BASE_URL the same way
#
# Legacy variables (ORCHESTRATOR_HOST, API_VERSION, ORCHESTRATOR_URL) are
# still supported for backward compatibility but should not be used in new code.
#

