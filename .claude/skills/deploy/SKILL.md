---
name: deploy
description: Deploy Lambda workers to LocalStack for a given workflow.
---

Deploy Lambda worker functions to LocalStack.

Arguments: $ARGUMENTS

Available workflows:
- `all` — Deploy all 3 workflows + start SQS pollers
- `order` — Deploy order-processing workers only
- `iot` — Deploy iot-sensor-pipeline workers only
- `infra` — Deploy infra-provisioning workers only

Deploy commands:
- Full deploy: `cd sms && ./scripts/local-env.sh deploy-workers`
- Per-workflow: `cd sms/workflows/{workflow}/workers && node scripts/deploy-to-localstack.js`

After deployment, verify with: `./scripts/local-env.sh list workers`

Docker status: !`docker ps --format "table {{.Names}}\t{{.Status}}" 2>/dev/null | head -20`
