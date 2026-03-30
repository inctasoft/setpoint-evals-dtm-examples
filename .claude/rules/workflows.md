---
paths:
  - "workflows/**"
---
# Workflow Rules

- Step names must use domain verbs, NOT Extract/Transform (ETL terminology)
  - Order Processing: Validate* / Submit* (e.g., ValidateCustomer, SubmitOrder)
  - IoT Sensor Pipeline: Register/Ingest/Evaluate* / Provision/Publish/Dispatch*
  - Infra Provisioning: Plan* / Apply* (Terraform-style)
- Queue names use kebab-case: `{workflow}-{verb}-{entity}` (e.g., `order-validate-customer`)
- Each workflow has: `workflow.config.ts`, `workers/`, `source-db/`, `dev-tools/`, `ste/`
- Cascade configs use `inputStep` (phase 1) and `outputStep` (phase 2) — not `extractStep`/`transformStep`
- Entity types use domain names (e.g., `lineItem` not `orderItem`)
- The `00-template/` directory is the starting point for new workflows
- Lambda deploy scripts must exist per workflow: `workers/scripts/deploy-to-localstack.js`
