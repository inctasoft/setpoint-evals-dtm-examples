# DTM Master Documentation Index

Quick navigation to all DTM documentation, organized by use case.

---

## Quick Start

1. **[README.md](../README.md)** - Project overview and getting started
2. **[guides/ENV-FILES-USAGE.md](guides/ENV-FILES-USAGE.md)** - Environment setup
3. **[guides/LOCALSTACK-CONFIGURATION.md](guides/LOCALSTACK-CONFIGURATION.md)** - LocalStack parameters

---

## By Use Case

### I want to understand the DTM engine

- **[guides/system-architecture.md](guides/system-architecture.md)** - Engine architecture with component diagrams
- **[guides/request-lifecycle.md](guides/request-lifecycle.md)** - End-to-end request trace (API → SQS → Worker → Callback → ACK → Complete)
- **[guides/orchestration-decision-logic.md](guides/orchestration-decision-logic.md)** - continueJob() decision tree, race conditions
- **[guides/callback-contract.md](guides/callback-contract.md)** - Worker callback HTTP contract (request/response)
- **[guides/database-schema-overview.md](guides/database-schema-overview.md)** - Core tables, columns, relationships
- **[guides/step-status-machine.md](guides/step-status-machine.md)** - Full step state machine (10 states)
- **[guides/outcome-rules.md](guides/outcome-rules.md)** - Entity criticality, outcome rule evaluation
- **[guides/race-condition-prevention.md](guides/race-condition-prevention.md)** - Callback protocol and race prevention
- **[guides/workflow-definition-contract.md](guides/workflow-definition-contract.md)** - WorkflowDefinition interface fields
- **[diagrams/architecture.mermaid](diagrams/architecture.mermaid)** - High-level overview diagram
- **[diagrams/request-lifecycle.mermaid](diagrams/request-lifecycle.mermaid)** - End-to-end sequence diagram
- **[diagrams/continuejob-decision-tree.mermaid](diagrams/continuejob-decision-tree.mermaid)** - continueJob() flowchart

### I want to create a new workflow

- **[guides/creating-a-workflow.md](guides/creating-a-workflow.md)** - Step-by-step workflow creation guide
- **[../workflows/00-template/](../workflows/00-template/)** - Starter template with checklist
- **[../workflows/00-template/CHECKLIST.md](../workflows/00-template/CHECKLIST.md)** - Step-by-step implementation guide
- **[../CLAUDE.md](../CLAUDE.md)** → "Adding a New Workflow" section — Integration checklist

### I want to write SEs (Setpoint Evals)

- **[TEST-OPTIONS-GUIDE.md](TEST-OPTIONS-GUIDE.md)** - Complete TestOptionSet reference
- **[../setpoint-evals/README.md](../setpoint-evals/README.md)** - Core SE system overview
- **[../setpoint-evals/shared/helpers.sh](../setpoint-evals/shared/helpers.sh)** - Generic SE helper functions
- **[../setpoint-evals/shared/helpers.sh](../setpoint-evals/shared/helpers.sh)** → `create_ste_from_template()` — New SE creation helper

### I want to run SEs

- Core: `./setpoint-evals/run-all.sh`
- All workflows: `./setpoint-evals/run-all.sh --all-workflows`
- **[guides/DEMO-VIDEOS.md](guides/DEMO-VIDEOS.md)** - Recording demo videos of the dashboard with Playwright

### I want to browse or run SEs from the dashboard (no shell)

- The Monitor Dashboard's **Scenarios** tab lists every discovered SE, suite-tabbed, rendering
  each one's gherkin Scenario + mermaid diagram + Payload + Assertions checklist straight from
  its README (sanitized markdown, no `dangerouslySetInnerHTML`); a gated **Run** button re-issues
  the README's own Payload through the existing job API — it never shells out. See "Monitor
  Dashboard" in `../CLAUDE.md` and `ENABLE_EVAL_RUN_API` in `.env.example`.

### I want to understand the CI pipeline / what "green" actually proves

- `../CLAUDE.md` → "Continuous Integration" — the 4 real jobs (lint, unit tests, hygiene scan,
  SE-README structure) vs. the scheduled placeholder that intentionally runs nothing; and why the
  real SE-execution gate is local evidence pasted into the PR body, not a CI job.

### I want to configure the environment

- **[guides/ENV-FILES-USAGE.md](guides/ENV-FILES-USAGE.md)** - Environment files guide
- **[guides/LOCALSTACK-CONFIGURATION.md](guides/LOCALSTACK-CONFIGURATION.md)** - LocalStack parameters
- **[guides/DEPLOYMENT-MODES.md](guides/DEPLOYMENT-MODES.md)** - ESM vs Poller modes

### I want to understand fan-out and cascade

- **[guides/system-architecture.md](guides/system-architecture.md)** - Fan-out pattern section
- **[diagrams/fan-out-lifecycle.mermaid](diagrams/fan-out-lifecycle.mermaid)** - Discovery → children → aggregation
- **[diagrams/cascade-fk-flow.mermaid](diagrams/cascade-fk-flow.mermaid)** - FK cascade injection sequence
- **[diagrams/partial-success-flow.mermaid](diagrams/partial-success-flow.mermaid)** - Partial success handling

### I want to understand features

- **[guides/FEATURES.md](guides/FEATURES.md)** - Feature documentation
- **[TEST-OPTIONS-GUIDE.md](TEST-OPTIONS-GUIDE.md)** - testOptions reference
- **[guides/MAINTENANCE-TASKS.md](guides/MAINTENANCE-TASKS.md)** - Maintenance system

### I'm working on a specific workflow

- **[../workflows/order-processing/README.md](../workflows/order-processing/README.md)** - Order Processing workflow
- **[../workflows/iot-sensor-pipeline/README.md](../workflows/iot-sensor-pipeline/README.md)** - IoT Sensor Pipeline workflow
- **[../workflows/infra-provisioning/README.md](../workflows/infra-provisioning/README.md)** - Infra Provisioning workflow

---

## By Directory

### `docs/guides/` (27 guides)

**Architecture & Orchestration:**
- **[architecture-c4.md](guides/architecture-c4.md)** - C4 context + container diagrams (system boundary, monitor, evals module)
- **[system-architecture.md](guides/system-architecture.md)** - Complete 9-section architecture (2270 lines)
- **[request-lifecycle.md](guides/request-lifecycle.md)** - End-to-end request trace
- **[orchestration-decision-logic.md](guides/orchestration-decision-logic.md)** - continueJob() decision tree
- **[outcome-rules.md](guides/outcome-rules.md)** - Entity criticality, outcome rules
- **[step-status-machine.md](guides/step-status-machine.md)** - Full state machine (10 states)
- **[race-condition-prevention.md](guides/race-condition-prevention.md)** - 4 race conditions fixed
- **[workflow-definition-contract.md](guides/workflow-definition-contract.md)** - WorkflowDefinition fields
- **[creating-a-workflow.md](guides/creating-a-workflow.md)** - New workflow guide
- **[callback-contract.md](guides/callback-contract.md)** - Worker callback HTTP contract
- **[database-schema-overview.md](guides/database-schema-overview.md)** - Core DB tables and columns

**Features & Capabilities:**
- **[FEATURES.md](guides/FEATURES.md)** - Feature documentation (delays, dedup, ACK)
- **[PER-REQUEST-DEDUPLICATION.md](guides/PER-REQUEST-DEDUPLICATION.md)** - Deduplication details
- **[MAINTENANCE-TASKS.md](guides/MAINTENANCE-TASKS.md)** - Maintenance tasks & scheduler
- **[feature-summary.md](guides/feature-summary.md)** - Quick feature overview
- **[retry-testing-examples.md](guides/retry-testing-examples.md)** - Retry testing patterns

**Infrastructure & Operations:**
- **[DEPLOYMENT-MODES.md](guides/DEPLOYMENT-MODES.md)** - ESM vs Poller, scaling
- **[DOCKER-ECOSYSTEM.md](guides/DOCKER-ECOSYSTEM.md)** - Docker layering, compose files
- **[LOCALSTACK-CONFIGURATION.md](guides/LOCALSTACK-CONFIGURATION.md)** - AWS emulation tuning
- **[ENV-FILES-USAGE.md](guides/ENV-FILES-USAGE.md)** - Environment files
- **[env-validation.md](guides/env-validation.md)** - Env var validation
- **[KAFKA-CONNECTIVITY-FIX.md](guides/KAFKA-CONNECTIVITY-FIX.md)** - Kafka debugging
- **[api-version-configuration.md](guides/api-version-configuration.md)** - API versioning

**Testing & Development:**
- **[worker-testing-guide.md](guides/worker-testing-guide.md)** - Lambda worker testing
- **[quick-start-api-testing.md](guides/quick-start-api-testing.md)** - API testing examples
- **[quick-start-kafka-consumer.md](guides/quick-start-kafka-consumer.md)** - Kafka consumer setup
- **[DEMO-VIDEOS.md](guides/DEMO-VIDEOS.md)** - Playwright demo video recording
- **[monitor-dashboard.md](guides/monitor-dashboard.md)** - Monitor Dashboard (Dashboard + Scenarios tabs, WebSocket/REST)

### `docs/diagrams/` (13 diagrams)
- **[architecture.mermaid](diagrams/architecture.mermaid)** - Quick overview
- **[architecture-detailed.mermaid](diagrams/architecture-detailed.mermaid)** - Detailed module diagram
- **[request-lifecycle.mermaid](diagrams/request-lifecycle.mermaid)** - End-to-end sequence
- **[continuejob-decision-tree.mermaid](diagrams/continuejob-decision-tree.mermaid)** - continueJob() flowchart
- **[step-status-state-machine.mermaid](diagrams/step-status-state-machine.mermaid)** - Step status transitions
- **[callback-flow-race-prevention.mermaid](diagrams/callback-flow-race-prevention.mermaid)** - Race prevention guards
- **[cascade-fk-flow.mermaid](diagrams/cascade-fk-flow.mermaid)** - FK cascade injection
- **[fan-out-lifecycle.mermaid](diagrams/fan-out-lifecycle.mermaid)** - Discovery → children → aggregation
- **[partial-success-flow.mermaid](diagrams/partial-success-flow.mermaid)** - Partial success handling
- **[docker-layering.mermaid](diagrams/docker-layering.mermaid)** - Docker Compose layers
- **[order-processing-steps.mermaid](diagrams/order-processing-steps.mermaid)** - Order Processing step DAG
- **[iot-sensor-pipeline-steps.mermaid](diagrams/iot-sensor-pipeline-steps.mermaid)** - IoT Sensor Pipeline step DAG
- **[infra-provisioning-steps.mermaid](diagrams/infra-provisioning-steps.mermaid)** - Infra Provisioning step DAG

---

## AI Assistant Rules

Located in `../.cursor/`:
- **[worker-writer.mdc](../.cursor/worker-writer.mdc)** - Worker development guide
- **[architecture.mdc](../.cursor/architecture.mdc)** - Engine architecture

---

## Documentation Stats

| Category | Location | Count |
|----------|----------|-------|
| Core Guides | `docs/guides/` | 28 files |
| Core Diagrams | `docs/diagrams/` | 13 mermaid files |
| Core SEs | `setpoint-evals/` | 28 tests |
| Workflow SEs | `workflows/*/setpoint-evals/` | 27 tests (9+9+9) |
| AI Rules (core) | `.cursor/` | 14 .mdc files |
| AI Rules (workflow) | `workflows/*/.cursor/` | Per-workflow agent guides |
| AI Agent Guide | `CLAUDE.md` | Primary agent knowledge base |

Counts are a snapshot, not a contract — the SE estate grows with the engine. Treat the
filesystem (`ls setpoint-evals/ | grep ^SE-`) as the source of truth.

---

**Last Updated:** 2026-07-18 (Phase 6 documentation closeout)
**Organization:** Use-case-based navigation
