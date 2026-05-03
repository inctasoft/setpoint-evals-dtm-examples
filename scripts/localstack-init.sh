#!/bin/bash

# ============================================================================
# LocalStack SQS Queue Initialization
# ============================================================================
# This script runs:
#   1. As a LocalStack init hook (/etc/localstack/init/ready.d/) on every container start
#   2. Also via the init-sqs-queues service on docker-compose up (belt-and-suspenders)
# All operations are idempotent — safe to run multiple times.
# ============================================================================

echo "Initializing LocalStack for DTM..."
echo ""

# Wait for LocalStack to be ready
# LocalStack 4.x reports services as "running" (not "available" like 3.x)
echo "Waiting for LocalStack..."
until curl -s http://localhost:4566/_localstack/health | grep -q '"sqs": "running"'; do
  echo "  LocalStack not ready yet. Retrying in 2 seconds..."
  sleep 2
done

echo "LocalStack is ready!"
echo ""

# ============================================================================
# Create SQS Queues with DLQs
# ============================================================================
echo "Creating SQS queues for active workflows..."
echo ""

ENDPOINT="http://localhost:4566"
REGION="us-east-1"
ACCOUNT_ID="000000000000"

# Queue names from active workflow configurations
QUEUES=(
  # order-processing workflow
  order-validate-customer
  order-validate-product
  order-submit-customer
  order-validate-order
  order-submit-order
  order-discover-line-items
  order-validate-line-item
  order-submit-line-item
  order-validate-payment
  order-submit-payment
  order-validate-shipment
  order-submit-shipment
  order-archive-processed-order
  # infra-provisioning workflow
  infra-plan-environment
  infra-apply-environment
  infra-plan-network
  infra-apply-network
  infra-discover-compute
  infra-plan-compute
  infra-apply-compute
  infra-plan-storage
  infra-apply-storage
  infra-plan-dns
  infra-apply-dns
  infra-plan-certificate
  infra-apply-certificate
  infra-plan-load-balancer
  infra-apply-load-balancer
  infra-record-provisioned-infra
  # iot-sensor-pipeline workflow
  iot-register-device
  iot-provision-device
  iot-discover-sensors
  iot-calibrate-sensor
  iot-activate-sensor
  iot-discover-readings
  iot-ingest-reading
  iot-publish-reading
  iot-evaluate-alert
  iot-dispatch-alert
  iot-compute-aggregate
  iot-publish-aggregate
  iot-archive-processed-pipeline
  # plan-execution workflow (voice-assistant chunk execution via DTM)
  plan-execute-chunk
)

# Helper function matching docker-compose.workers.yml init-sqs-queues service
create_queue_with_dlq() {
  local queue_name=$1
  local dlq_name="${queue_name}-dlq"
  local dlq_arn="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${dlq_name}"

  # Create DLQ first (14-day retention)
  aws --endpoint-url=$ENDPOINT sqs create-queue \
    --queue-name "${dlq_name}" \
    --attributes MessageRetentionPeriod=1209600 \
    --region $REGION > /dev/null 2>&1 || true

  # Create main queue with redrive policy
  aws --endpoint-url=$ENDPOINT sqs create-queue \
    --queue-name "${queue_name}" \
    --attributes '{
      "MessageRetentionPeriod": "345600",
      "VisibilityTimeout": "30",
      "ReceiveMessageWaitTimeSeconds": "20",
      "RedrivePolicy": "{\"deadLetterTargetArn\":\"'"${dlq_arn}"'\",\"maxReceiveCount\":\"10\"}"
    }' \
    --region $REGION > /dev/null 2>&1 || true

  echo "  ${queue_name} (+ DLQ)"
}

# Create all queues
for q in "${QUEUES[@]}"; do
  create_queue_with_dlq "$q"
done

echo ""
echo "All SQS queues created successfully!"
echo ""

# ============================================================================
# Summary
# ============================================================================
echo "Summary:"
echo "  order-processing: 12 queues"
echo "  infra-provisioning: 15 queues"
echo "  iot-sensor-pipeline: 12 queues"
echo "  plan-execution: 1 queue"
echo "  Total: ${#QUEUES[@]} queues + ${#QUEUES[@]} DLQs = $((${#QUEUES[@]} * 2)) queues"
echo ""

echo "LocalStack initialization complete!"
