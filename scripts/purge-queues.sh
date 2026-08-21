#!/bin/bash
# Purge all SQS queues on dtm-localstack
aws --endpoint-url=http://localhost:4567 sqs list-queues --region us-east-1 --output text 2>/dev/null | tr '\t' '\n' | while read url; do
  [ -n "$url" ] && [ "$url" != "QUEUEURLS" ] && aws --endpoint-url=http://localhost:4567 sqs purge-queue --queue-url "$url" --region us-east-1 2>/dev/null
done
echo "All queues purged"
