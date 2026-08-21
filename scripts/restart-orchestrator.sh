#!/bin/bash
docker restart dtm-orchestrator
echo "Orchestrator restarted"
sleep 5
curl -s http://localhost:3002/api/v1/workflows 2>/dev/null | head -c 200
echo ""
echo "Orchestrator is ready"
