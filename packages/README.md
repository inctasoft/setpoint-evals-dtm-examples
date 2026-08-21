# Packages

Shared libraries used across services, tools, and workflows.

## Contents

| Package | npm name | Purpose |
|---------|----------|---------|
| `core/` | `@dtm/core` | Core interfaces, enums, and type definitions (WorkflowDefinition, StepStatus, JobStatus) |
| `database/` | `@dtm/database` | TypeORM entities (Job, Step), repositories, migrations, and datasource config |
| `worker-sdk/` | `@dtm/worker-sdk` | Lambda worker utilities — message parsing, callback helpers, error handling |
| `kafka-producer/` | `@dtm/kafka-producer` | Kafka event publishing (used by orchestrator) |
| `kafka-consumer/` | `@dtm/kafka-consumer` | Kafka event consumption with DLQ support (used by dev-ack-simulator) |
| `errors/` | `@dtm/errors` | Custom error classes for HTTP, NestJS, and core error handling |

## Dependency Order

Build order matters (each package may depend on earlier ones):

```
core → errors → database → kafka-producer → kafka-consumer
              → worker-sdk
```

## Building

```bash
# Build all packages
pnpm build:packages

# Build a specific package
pnpm --filter @dtm/core run build
```
