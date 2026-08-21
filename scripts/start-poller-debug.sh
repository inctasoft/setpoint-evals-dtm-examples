#!/bin/bash
# Start SQS poller in debug-server mode (in-process handler execution)
# Run from repo root: bash scripts/start-poller-debug.sh

cd "$(dirname "$0")/.." || exit 1

# Kill any existing poller
pkill -f "tsx.*poller" 2>/dev/null
sleep 1

LOG_FILE="$(pwd)/poller-debug.log"
echo "Starting SQS poller in debug-server mode..."
echo "Log file: $LOG_FILE"

# All env vars passed inline to ensure they reach the child process
nohup env \
  AWS_REGION=us-east-1 \
  AWS_ACCOUNT_ID=000000000000 \
  AWS_SQS_ENDPOINT=http://localhost:4567 \
  ORCHESTRATOR_CALLBACK_URL=http://localhost:3002 \
  DEBUG_SERVER_MODE=true \
  MAX_MESSAGES_PER_POLL=10 \
  ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true \
  DTM_DB_HOST=localhost \
  DTM_DB_PORT=5448 \
  DTM_DB_USER=dtm_user \
  DTM_DB_PASSWORD=your_password \
  DTM_DB_NAME=dtm \
  ORDER_PROCESSING_DB_HOST=localhost \
  ORDER_PROCESSING_DB_PORT=5449 \
  ORDER_PROCESSING_DB_USER=order_user \
  ORDER_PROCESSING_DB_PASSWORD=order_pass \
  ORDER_PROCESSING_DB_NAME=order_processing_db \
  IOT_SENSOR_DB_HOST=localhost \
  IOT_SENSOR_DB_PORT=5450 \
  IOT_SENSOR_DB_USER=iot_user \
  IOT_SENSOR_DB_PASSWORD=iot_pass \
  IOT_SENSOR_DB_NAME=iot_sensor_pipeline_db \
  INFRA_PROVISIONING_DB_HOST=localhost \
  INFRA_PROVISIONING_DB_PORT=5451 \
  INFRA_PROVISIONING_DB_USER=infra_user \
  INFRA_PROVISIONING_DB_PASSWORD=infra_pass \
  INFRA_PROVISIONING_DB_NAME=infra_provisioning_db \
  npx tsx tools/sqs-poller/src/poller.ts > "$LOG_FILE" 2>&1 &
POLLER_PID=$!
echo "Poller PID: $POLLER_PID"

# Wait for startup
sleep 15
echo ""
echo "=== Startup Log ==="
head -40 "$LOG_FILE"
echo ""
echo "Poller is running in background. Check logs: tail -f $LOG_FILE"
