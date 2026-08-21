#!/bin/bash
set -e
cd "$(dirname "$0")/.."

echo "=== Step 1: Compile infra-provisioning workflow config ==="
npx tsc --project workflows/infra-provisioning/tsconfig.json 2>&1
echo "Compiled successfully"

echo ""
echo "=== Step 2: Verify filterKey changes in compiled JS ==="
grep -n "filterKey" workflows/infra-provisioning/dist/workflow.config.js

echo ""
echo "=== Step 3: Copy compiled config to orchestrator container ==="
docker cp workflows/infra-provisioning/dist/workflow.config.js dtm-orchestrator:/app/workflows/infra-provisioning/dist/workflow.config.js 2>&1
echo "Config deployed to container"

echo ""
echo "=== Step 4: Verify config in container ==="
docker exec dtm-orchestrator grep "filterKey" /app/workflows/infra-provisioning/dist/workflow.config.js 2>&1

echo ""
echo "=== Step 5: Restart orchestrator ==="
docker restart dtm-orchestrator 2>&1
echo "Orchestrator restarting..."
sleep 10

echo ""
echo "=== Step 6: Check orchestrator health ==="
docker ps --filter "name=dtm-orchestrator" --format '{{.Names}} {{.Status}}'

echo ""
echo "=== Step 7: Verify seed data in source DB ==="
docker exec dtm-infra-provisioning-source-db psql -U infra_user -d infra_provisioning_db -c "SELECT certificate_id, domain FROM dbo.certificates;" 2>&1
docker exec dtm-infra-provisioning-source-db psql -U infra_user -d infra_provisioning_db -c "SELECT lb_id, name FROM dbo.load_balancers;" 2>&1

echo ""
echo "=== Step 8: Purge SQS queues ==="
aws --endpoint-url=http://localhost:4567 sqs list-queues --region us-east-1 --output text 2>/dev/null | tr '\t' '\n' | while read url; do
  [ -n "$url" ] && [ "$url" != "QUEUEURLS" ] && aws --endpoint-url=http://localhost:4567 sqs purge-queue --queue-url "$url" --region us-east-1 2>/dev/null
done
echo "Queues purged"

echo ""
echo "=== Step 9: Start host poller ==="
pkill -f "tsx.*poller" 2>/dev/null
sleep 2
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=000000000000
export AWS_SQS_ENDPOINT=http://localhost:4567
export ORCHESTRATOR_CALLBACK_URL=http://localhost:3002
export DEBUG_SERVER_MODE=true
export DTM_DB_HOST=localhost
export DTM_DB_PORT=5448
export DTM_DB_USER=dtm_user
export DTM_DB_PASSWORD=your_password
export DTM_DB_NAME=dtm
export ORDER_PROCESSING_DB_HOST=localhost
export ORDER_PROCESSING_DB_PORT=5449
export ORDER_PROCESSING_DB_USER=order_user
export ORDER_PROCESSING_DB_PASSWORD=order_pass
export ORDER_PROCESSING_DB_NAME=order_processing_db
export IOT_SENSOR_DB_HOST=localhost
export IOT_SENSOR_DB_PORT=5450
export IOT_SENSOR_DB_USER=iot_user
export IOT_SENSOR_DB_PASSWORD=iot_pass
export IOT_SENSOR_DB_NAME=iot_sensor_pipeline_db
export INFRA_PROVISIONING_DB_HOST=localhost
export INFRA_PROVISIONING_DB_PORT=5451
export INFRA_PROVISIONING_DB_USER=infra_user
export INFRA_PROVISIONING_DB_PASSWORD=infra_pass
export INFRA_PROVISIONING_DB_NAME=infra_provisioning_db
export MAX_MESSAGES_PER_POLL=10

LOG_FILE="$(pwd)/poller-debug.log"
rm -f "$LOG_FILE"
nohup npx tsx tools/sqs-poller/src/poller.ts > "$LOG_FILE" 2>&1 &
POLLER_PID=$!
echo "Poller PID: $POLLER_PID"
sleep 15
echo ""
echo "=== Startup Log ==="
head -40 "$LOG_FILE"
echo ""
echo "=== Setup Complete ==="
