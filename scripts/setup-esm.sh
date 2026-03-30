#!/bin/bash

# ============================================================================
# Setup Lambda Event Source Mappings (ESM) for LocalStack
# ============================================================================
# This script creates native AWS Event Source Mappings that connect SQS queues
# to Lambda functions, enabling parallel execution through LocalStack's ESM v2.
#
# Usage:
#   ./scripts/setup-esm.sh
#
# Prerequisites:
#   - LocalStack running with LAMBDA_EVENT_SOURCE_MAPPING=v2
#   - Lambda functions deployed
#   - SQS queue created
# ============================================================================

set -e

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/inc/common.sh"

# Configuration
LOCALSTACK_ENDPOINT="${AWS_ENDPOINT_URL:-http://localhost:${LOCALSTACK_PORT:-4567}}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-000000000000}"
MAX_CONCURRENCY=50  # Simulate AWS Lambda auto-scaling (max 50 parallel executions)

print_header "Setting up Lambda Event Source Mappings (ESM)"

echo ""
print_info "Configuration:"
print_info "  LocalStack:       ${LOCALSTACK_ENDPOINT}"
print_info "  Max Concurrency:  ${MAX_CONCURRENCY}"
echo ""

# Queue-to-worker mapping (queue names match Lambda function names)
# NOTE: This is an example for order-processing. Each workflow has its own queues.
# In practice, queues are auto-created by localstack-init.sh from workflow configs.
declare -A QUEUE_WORKER_MAP=(
    ["order-validate-customer"]="order-validate-customer"
    ["order-submit-customer"]="order-submit-customer"
    ["order-validate-product"]="order-validate-product"
    ["order-validate-order"]="order-validate-order"
    ["order-submit-order"]="order-submit-order"
    ["order-validate-payment"]="order-validate-payment"
    ["order-submit-payment"]="order-submit-payment"
)

# Function to create ESM for a Lambda function + queue
create_esm() {
    local queue_name=$1
    local function_name=$2
    
    local queue_arn="arn:aws:sqs:${AWS_REGION}:${AWS_ACCOUNT_ID}:${queue_name}"
    
    print_info "Creating ESM: ${queue_name} → ${function_name}..."
    
    # Check if function exists
    if ! awslocal lambda get-function --function-name "${function_name}" &>/dev/null; then
        print_warning "  Function ${function_name} not found - skipping"
        return 1
    fi
    
    # Check if ESM already exists for this queue
    existing_esms=$(awslocal lambda list-event-source-mappings \
        --function-name "${function_name}" \
        --query "EventSourceMappings[?EventSourceArn=='${queue_arn}'].UUID" \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$existing_esms" ]; then
        print_info "  ESM already exists (UUID: ${existing_esms}) - skipping creation"
        return 0
    fi
    
    # Create the Event Source Mapping
    esm_uuid=$(awslocal lambda create-event-source-mapping \
        --function-name "${function_name}" \
        --event-source-arn "${queue_arn}" \
        --batch-size 1 \
        --maximum-batching-window-in-seconds 0 \
        --scaling-config MaximumConcurrency=${MAX_CONCURRENCY} \
        --function-response-types ReportBatchItemFailures \
        --enabled \
        --query 'UUID' \
        --output text 2>&1)
    
    if [ $? -eq 0 ]; then
        print_success "  Created ESM (UUID: ${esm_uuid})"
        
        # WORKAROUND: LocalStack create API doesn't always apply all settings
        # Update the ESM after creation to ensure settings are applied
        awslocal lambda update-event-source-mapping \
            --uuid "${esm_uuid}" \
            --function-response-types ReportBatchItemFailures \
            --scaling-config MaximumConcurrency=${MAX_CONCURRENCY} &>/dev/null || true
        
        # Optional: Set function-level concurrency limit
        awslocal lambda put-function-concurrency \
            --function-name "${function_name}" \
            --reserved-concurrent-executions ${MAX_CONCURRENCY} &>/dev/null || true
        
        return 0
    else
        print_error "  Failed to create ESM"
        echo "    Error: ${esm_uuid}"
        return 1
    fi
}

# Create ESMs for all queue-worker mappings
success_count=0
total_count=${#QUEUE_WORKER_MAP[@]}

for queue_name in "${!QUEUE_WORKER_MAP[@]}"; do
    function_name="${QUEUE_WORKER_MAP[$queue_name]}"
    if create_esm "${queue_name}" "${function_name}"; then
        ((success_count++))
    fi
    echo ""
done

# Summary
print_header "ESM Setup Complete"
echo ""
print_info "Created ${success_count}/${total_count} Event Source Mappings"
echo ""

if [ $success_count -eq $total_count ]; then
    print_success "✅ All ESMs created successfully!"
    print_info ""
    print_info "ESM Configuration:"
    print_info "  • MaximumConcurrency: ${MAX_CONCURRENCY} (up to ${MAX_CONCURRENCY} Lambdas run in parallel)"
    print_info "  • BatchSize: 1 (process 1 message per invocation)"
    print_info "  • Mode: ESM v2 (LocalStack native parallelism)"
    print_info ""
    print_info "To verify ESMs are working:"
    print_info "  awslocal lambda list-event-source-mappings"
    print_info ""
    print_info "To monitor parallel execution:"
    print_info "  watch -n 0.5 \"docker ps | grep lambda\""
    echo ""
    exit 0
else
    print_warning "⚠️  Some ESMs failed to create (${success_count}/${total_count})"
    print_info ""
    print_info "Check that:"
    print_info "  1. LocalStack is running with LAMBDA_EVENT_SOURCE_MAPPING=v2"
    print_info "  2. Lambda functions are deployed (./scripts/local-env.sh deploy-workers)"
    print_info "  3. SQS queue exists"
    echo ""
    exit 1
fi

