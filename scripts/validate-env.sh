#!/bin/bash

# ═══════════════════════════════════════════════════════════════════════════
# Environment Variable Validation Script
# ═══════════════════════════════════════════════════════════════════════════
# Validates that required environment variables are set before running tests
# or deployments. Helps prevent common configuration issues.
#
# Usage:
#   ./scripts/validate-env.sh                    # Validate current environment
#   ./scripts/validate-env.sh .env.development  # Validate specific file
#   ./scripts/validate-env.sh --scenario e2e-tests  # Scenario-specific validation
#   ./scripts/validate-env.sh --verbose         # Detailed output
#
# Exit Codes:
#   0 - All validations passed
#   1 - Critical validation failures
#   2 - Warnings detected (non-critical)

set -e

# ═══════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
ERRORS=0
WARNINGS=0
CHECKS=0

# Flags
VERBOSE=false
SCENARIO="general"
ENV_FILE="${PROJECT_ROOT}/.env"

# ═══════════════════════════════════════════════════════════════════════════
# Parse Arguments
# ═══════════════════════════════════════════════════════════════════════════

while [[ $# -gt 0 ]]; do
  case $1 in
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --scenario|-s)
      SCENARIO="$2"
      shift 2
      ;;
    --help|-h)
      cat << EOF
Environment Variable Validation Script

Usage:
  ./scripts/validate-env.sh [OPTIONS] [ENV_FILE]

Arguments:
  ENV_FILE    Path to .env file to validate (default: .env)

Options:
  --verbose, -v           Show detailed output with recommendations
  --scenario, -s SCENARIO Validate for specific scenario
  --help, -h              Show this help message

Scenarios:
  general       General validation (default)
  local-dev     Local development requirements
  e2e-tests     E2E testing requirements
  production    Production deployment requirements

Exit Codes:
  0 - All validations passed
  1 - Critical validation failures
  2 - Warnings detected (non-critical)

Examples:
  ./scripts/validate-env.sh
  ./scripts/validate-env.sh .env.development
  ./scripts/validate-env.sh --scenario e2e-tests --verbose

Documentation:
  See ENV-VALIDATION.md for detailed information about required variables

EOF
      exit 0
      ;;
    *)
      # Assume it's an env file path
      if [[ -f "$1" ]]; then
        ENV_FILE="$1"
      else
        echo -e "${RED}❌ File not found: $1${NC}"
        exit 1
      fi
      shift
      ;;
  esac
done

# ═══════════════════════════════════════════════════════════════════════════
# Helper Functions
# ═══════════════════════════════════════════════════════════════════════════

log_header() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

log_info() {
  if $VERBOSE; then
    echo -e "${BLUE}ℹ${NC}  $1"
  fi
}

log_success() {
  echo -e "${GREEN}✅${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC}  $1"
  WARNINGS=$((WARNINGS + 1))
}

log_error() {
  echo -e "${RED}❌${NC} $1"
  ERRORS=$((ERRORS + 1))
}

# Load environment file
load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    log_info "Loading environment from: $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
  else
    log_error "Environment file not found: $ENV_FILE"
    exit 1
  fi
}

# Validate variable exists
validate_exists() {
  local var_name="$1"
  local var_value="${!var_name}"
  
  CHECKS=$((CHECKS + 1))
  
  if [[ -z "$var_value" ]]; then
    log_error "${var_name} is not set"
    if $VERBOSE && [[ -n "$2" ]]; then
      echo "   ${2}"
    fi
    return 1
  else
    log_success "${var_name}: ${var_value}"
    return 0
  fi
}

# Validate variable equals expected value
validate_equals() {
  local var_name="$1"
  local expected="$2"
  local message="$3"
  local var_value="${!var_name}"
  
  CHECKS=$((CHECKS + 1))
  
  if [[ -z "$var_value" ]]; then
    log_error "${var_name} is not set"
    return 1
  elif [[ "$var_value" != "$expected" ]]; then
    log_warning "${var_name}=${var_value} (expected: ${expected})"
    if $VERBOSE && [[ -n "$message" ]]; then
      echo "   ${message}"
    fi
    return 1
  else
    log_success "${var_name}: ${var_value}"
    return 0
  fi
}

# Validate boolean variable
validate_boolean() {
  local var_name="$1"
  local expected="$2"
  local var_value="${!var_name}"
  
  CHECKS=$((CHECKS + 1))
  
  if [[ -z "$var_value" ]]; then
    log_error "${var_name} is not set"
    if $VERBOSE; then
      echo "   Expected: ${expected}"
      echo "   Impact: ${3}"
    fi
    return 1
  elif [[ "$var_value" != "true" && "$var_value" != "false" ]]; then
    log_error "${var_name}=${var_value} (must be 'true' or 'false')"
    return 1
  elif [[ -n "$expected" && "$var_value" != "$expected" ]]; then
    log_warning "${var_name}=${var_value} (recommended: ${expected})"
    if $VERBOSE && [[ -n "$3" ]]; then
      echo "   ${3}"
    fi
    return 1
  else
    log_success "${var_name}: ${var_value}"
    return 0
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# Validation Functions by Category
# ═══════════════════════════════════════════════════════════════════════════

validate_database() {
  log_header "Database Configuration"
  
  # DTM Core Database
  validate_exists "DTM_DB_HOST" "DTM core database host"
  validate_exists "DTM_DB_PORT" "DTM core database port"
  validate_exists "DTM_DB_NAME" "DTM core database name"
  validate_exists "DTM_DB_USER" "DTM core database user"
  validate_exists "DTM_DB_PASSWORD" "DTM core database password"
  
}

validate_kafka() {
  log_header "Kafka Configuration"
  
  validate_exists "KAFKA_BROKER" "Kafka broker URL (e.g., kafka:9092)"
  validate_exists "KAFKA_CONSUMER_GROUP_ID" "Kafka consumer group ID"
}

validate_aws() {
  log_header "AWS / LocalStack Configuration"
  
  validate_exists "AWS_REGION" "AWS region"
  validate_exists "AWS_SQS_ENDPOINT" "AWS SQS endpoint (LocalStack: http://localstack:4566)"
  validate_exists "AWS_ACCESS_KEY_ID" "AWS access key"
  validate_exists "AWS_SECRET_ACCESS_KEY" "AWS secret key"
}

validate_feature_flags_local() {
  log_header "Feature Flags (Local Development)"
  
  validate_boolean "ENABLE_DEV_ACK_SIMULATOR" "true" \
    "CRITICAL: Must be 'true' for local dev. Without this, jobs will hang at WAITING_FOR_ACK."
  
  validate_boolean "ENABLE_REQUESTS_FOR_SIMULATED_DELAYS" "true" \
    "Recommended 'true' for local dev. Enables delay testing in Lambda workers."
  
  validate_boolean "ENABLE_DEDUPLICATION" "" \
    "Optional. Set to 'true' to prevent duplicate job requests."
}

validate_feature_flags_e2e() {
  log_header "Feature Flags (E2E Testing)"
  
  validate_boolean "ENABLE_DEV_ACK_SIMULATOR" "true" \
    "CRITICAL: MUST be 'true' for E2E tests. Jobs will hang without this."
  
  validate_boolean "ENABLE_REQUESTS_FOR_SIMULATED_DELAYS" "true" \
    "CRITICAL: MUST be 'true' for E2E delay/retry/DLQ tests."
  
  log_info "E2E tests require acknowledgement simulation and delay features"
}

validate_feature_flags_production() {
  log_header "Feature Flags (Production Safety)"
  
  validate_boolean "ENABLE_DEV_ACK_SIMULATOR" "false" \
    "CRITICAL: MUST be 'false' in production. This is a dev-only feature."
  
  validate_boolean "ENABLE_REQUESTS_FOR_SIMULATED_DELAYS" "false" \
    "CRITICAL: MUST be 'false' in production. Simulated delays are a security risk."
  
  validate_equals "NODE_ENV" "production" \
    "Should be 'production' to disable development features"
}

# ═══════════════════════════════════════════════════════════════════════════
# Scenario-Specific Validation
# ═══════════════════════════════════════════════════════════════════════════

validate_general() {
  log_header "🔍 Environment Validation: General"
  log_info "Validating file: ${ENV_FILE}"
  
  validate_database
  validate_kafka
  validate_aws
  validate_feature_flags_local
}

validate_local_dev() {
  log_header "🔍 Environment Validation: Local Development"
  log_info "Validating file: ${ENV_FILE}"
  
  validate_database
  validate_kafka
  validate_aws
  validate_feature_flags_local
}

validate_e2e_tests() {
  log_header "🔍 Environment Validation: E2E Testing"
  log_info "Validating file: ${ENV_FILE}"
  
  validate_database
  validate_kafka
  validate_aws
  validate_feature_flags_e2e
}

validate_production() {
  log_header "🔍 Environment Validation: Production Deployment"
  log_info "Validating file: ${ENV_FILE}"
  
  validate_database
  validate_kafka
  # Skip AWS validation for production (real AWS, not LocalStack)
  validate_feature_flags_production
}

# ═══════════════════════════════════════════════════════════════════════════
# Main Execution
# ═══════════════════════════════════════════════════════════════════════════

main() {
  # Load environment file
  load_env
  
  # Run scenario-specific validation
  case "$SCENARIO" in
    general)
      validate_general
      ;;
    local-dev)
      validate_local_dev
      ;;
    e2e-tests)
      validate_e2e_tests
      ;;
    production)
      validate_production
      ;;
    *)
      log_error "Unknown scenario: $SCENARIO"
      echo "Valid scenarios: general, local-dev, e2e-tests, production"
      exit 1
      ;;
  esac
  
  # Summary
  echo ""
  log_header "📊 Validation Summary"
  echo "Total checks: ${CHECKS}"
  echo "Errors: ${ERRORS}"
  echo "Warnings: ${WARNINGS}"
  echo ""
  
  # Exit based on results
  if [[ $ERRORS -gt 0 ]]; then
    log_error "Validation FAILED with ${ERRORS} error(s)"
    echo ""
    echo "Fix the errors above and re-run validation."
    echo "See ENV-VALIDATION.md for detailed documentation."
    exit 1
  elif [[ $WARNINGS -gt 0 ]]; then
    log_warning "Validation passed with ${WARNINGS} warning(s)"
    echo ""
    echo "Consider addressing warnings for optimal configuration."
    echo "Use --verbose flag for more details."
    exit 2
  else
    log_success "Validation PASSED - All checks successful!"
    echo ""
    exit 0
  fi
}

# Run main function
main

