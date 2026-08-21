#!/bin/bash
ESM_COUNT=$(aws --endpoint-url=http://localhost:4567 lambda list-event-source-mappings --region us-east-1 2>/dev/null | grep -c UUID)
echo "ESMs found: $ESM_COUNT"
if [ "$ESM_COUNT" -gt 0 ]; then
  echo "Deleting ESMs..."
  aws --endpoint-url=http://localhost:4567 lambda list-event-source-mappings --region us-east-1 --output json 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for m in data.get('EventSourceMappings', []):
    print(m['UUID'])
" | while read uuid; do
    aws --endpoint-url=http://localhost:4567 lambda delete-event-source-mapping --uuid "$uuid" --region us-east-1 2>/dev/null
    echo "Deleted: $uuid"
  done
fi
echo "ESM check/cleanup done"
