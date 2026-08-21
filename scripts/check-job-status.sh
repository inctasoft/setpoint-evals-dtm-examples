#!/bin/bash
# Check step statuses for a job
JOB_ID="${1:?Usage: $0 <job-id>}"
curl -s "http://localhost:3002/api/v1/jobs/${JOB_ID}" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'Job Status: {d.get(\"status\", \"unknown\")}')
print()
for s in d.get('steps', []):
    print(f'{s[\"stepNumber\"]:30s} {s[\"status\"]:25s} retries={s.get(\"retryCount\",0)} child={s.get(\"childEntityId\",\"-\")}')
"
