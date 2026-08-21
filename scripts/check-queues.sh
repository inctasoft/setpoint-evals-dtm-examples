#!/bin/bash
echo "=== Queues on port 4567 (dtm-localstack) ==="
aws --endpoint-url=http://localhost:4567 sqs list-queues --region us-east-1 --output text 2>/dev/null | tr '\t' '\n' | grep infra | head -5
echo ""
echo "=== Queues on port 4566 ==="
aws --endpoint-url=http://localhost:4566 sqs list-queues --region us-east-1 --output text 2>/dev/null | tr '\t' '\n' | grep infra | head -5
echo ""
echo "=== Poller env ==="
grep 'AWS_SQS_ENDPOINT\|MAX_MESSAGES' "$(dirname "$0")/start-poller-debug.sh"
