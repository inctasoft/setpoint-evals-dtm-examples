#!/bin/bash
# Purge all SQS queues on dtm-localstack and verify
QUEUES=$(aws --endpoint-url=http://localhost:4567 sqs list-queues --region us-east-1 --output json 2>/dev/null)
COUNT=$(echo "$QUEUES" | python3 -c "import sys,json; data=json.load(sys.stdin); urls=data.get('QueueUrls',[]); print(len(urls))" 2>/dev/null || echo "0")
echo "Found $COUNT queues"

echo "$QUEUES" | python3 -c "
import sys, json, subprocess
data = json.load(sys.stdin)
urls = data.get('QueueUrls', [])
for url in urls:
    subprocess.run(['aws', '--endpoint-url=http://localhost:4567', 'sqs', 'purge-queue', '--queue-url', url, '--region', 'us-east-1'], capture_output=True)
print(f'Purged {len(urls)} queues')
"
