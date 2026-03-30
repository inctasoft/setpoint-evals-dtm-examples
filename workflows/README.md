# Workflows

Fully functional **example workflows** that showcase orchestrator features and serve as templates for creating new workflows.

## Contents

| Workflow | Description | Steps | Entities |
|----------|-------------|-------|----------|
| `00-template/` | Starter template with implementation checklist | — | — |
| `order-processing/` | E-commerce order fulfillment with fan-out line items, payments, shipments | 12 | 5 (Customer, Order, LineItem, Payment, Shipment) |
| `iot-sensor-pipeline/` | IoT device onboarding → sensor calibration → data ingestion → alerting | 12 | 5 (Sensor, Location, Reading, Alert, Aggregate) |
| `infra-provisioning/` | Infrastructure provisioning: plan → apply for environments, networks, compute, DNS, certs, load balancers | 15 | 7 (Environment, Network, Compute, Storage, DNS, Certificate, LoadBalancer) |

## Workflow Structure

Each workflow is a self-contained package:

```
workflow-name/
├── workflow.config.ts         # Step DAG, entities, cascade config, outcome rules
├── package.json               # @dtm-workflows/workflow-name
├── source-db/                 # TypeORM entities for the workflow's source database
│   ├── src/entities/
│   ├── init-scripts/          # SQL seed data
│   └── package.json
├── workers/                   # Lambda handlers (one per step)
│   ├── src/handlers/
│   ├── scripts/deploy-to-localstack.js
│   └── package.json
├── dev-tools/                 # ACK payload generators, test utilities
├── ste/                       # Per-workflow State Transition Evaluations (5 each)
├── docker-compose.*.yml       # Source database container
└── README.md                  # Domain-specific documentation
```

## Creating a New Workflow

1. Copy `00-template/` to a new directory
2. Follow the checklist in `00-template/CHECKLIST.md`
3. See `docs/guides/creating-a-workflow.md` for the full guide

## Running Workflow STEs

```bash
# All workflows
./ste/run-all.sh --all-workflows

# Specific workflow
bash workflows/order-processing/ste/run-all.sh
```
