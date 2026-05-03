# Environment Configuration Guide

📚 This guide explains how the DTM orchestrator handles environment configuration with **automatic runtime detection**.

## Table of Contents

- [Overview](#overview)
- [Runtime Detection](#runtime-detection)
- [Quick Start](#quick-start)
- [Configuration Namespaces](#configuration-namespaces)
- [Environment Variables](#environment-variables)
- [Deployment Modes](#deployment-modes)
- [EKS Deployment](#eks-deployment)
- [Best Practices](#best-practices)

---

## Overview

The orchestrator uses **automatic runtime detection** to configure itself for different environments:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Runtime Detection                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Application Starts                                              │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────┐                                            │
│  │ K8S_SERVICE_HOST │──────▶ EKS Mode                           │
│  │   env exists?   │        (Uses ConfigMap/Secrets)             │
│  └────────┬────────┘                                            │
│           │ No                                                   │
│           ▼                                                         │
│  ┌─────────────────┐                                            │
│  │  /.dockerenv    │──────▶ Docker Mode                         │
│  │  file exists?   │        (Uses Docker service names)         │
│  └────────┬────────┘                                            │
│           │ No                                                   │
│           ▼                                                         │
│     Local Mode                                                   │
│     (Uses localhost with mapped ports)                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Key Benefits:**

- 🔄 **No file switching** - Single `.env` file works in all modes
- 🎯 **Zero configuration** - Hosts/ports auto-adjust per runtime
- ✅ **Type safety** - Typed config namespaces with validation
- 🚀 **EKS ready** - Works seamlessly with Kubernetes ConfigMaps

---

## Runtime Detection

The application automatically detects its environment:

| Mode       | Detection              | Database Host    | Kafka Broker      | AWS Endpoint             |
| ---------- | ---------------------- | ---------------- | ----------------- | ------------------------ |
| **Local**  | Default                | `localhost:5448` | `localhost:9093`  | `http://localhost:4566`  |
| **Docker** | `/.dockerenv` exists   | `dtm-db:5432`    | `dtm-kafka:29092` | `http://localstack:4566` |
| **EKS**    | `K8S_SERVICE_HOST` set | From ConfigMap   | From ConfigMap    | Real AWS (no endpoint)   |

### How It Works

```typescript
// src/config/runtime.config.ts
function detectRuntime(): "eks" | "docker" | "local" {
  if (process.env.K8S_SERVICE_HOST) return "eks";
  if (fs.existsSync("/.dockerenv")) return "docker";
  return "local";
}
```

---

## Quick Start

### 1. Copy the Example File

```bash
cp .env.example .env
```

### 2. Start Services

**Docker Mode (orchestrator in container):**

```bash
./scripts/local-env.sh start --standalone --orchestrator
```

**Local Debug Mode (orchestrator on host):**

```bash
./scripts/local-env.sh start --standalone
./scripts/local-env.sh deploy-workers --debug-server
```

The app auto-detects the mode and configures itself!

---

## Configuration Namespaces

The orchestrator uses typed configuration namespaces:

### `database` - DTM Core Database

```typescript
configService.get<string>("database.host"); // Auto: localhost | dtm-db
configService.get<number>("database.port"); // Auto: 5448 | 5432
configService.get<string>("database.username");
configService.get<string>("database.password");
```

### `kafka` - Kafka Configuration

```typescript
configService.get<string>("kafka.broker"); // Auto: localhost:9093 | dtm-kafka:29092
configService.get<string>("kafka.consumerGroupId");
configService.get<boolean>("kafka.publishEventsToKafka");
```

### `aws` - AWS/LocalStack Configuration

```typescript
configService.get<string>("aws.region");
configService.get<string>("aws.sqs.endpoint"); // Auto: localhost:4566 | localstack:4566 | undefined
configService.get<string>("aws.orchestratorCallbackUrl"); // Auto-detected per mode
```

### `app` - Application Settings

```typescript
configService.get<number>("app.port");
configService.get<boolean>("app.features.enableSimulatedDelays");
configService.get<boolean>("app.features.enableDeduplication");
configService.get<boolean>("app.autoMigration.onConsumerCreated");
```

---

## Environment Variables

### Core Variables

| Variable    | Description      | Default       |
| ----------- | ---------------- | ------------- |
| `NODE_ENV`  | Environment mode | `development` |
| `PORT`      | Server port      | `3000`        |
| `LOG_LEVEL` | Logging level    | `debug`       |

### Database Variables

| Variable                 | Description                   | Used In     |
| ------------------------ | ----------------------------- | ----------- |
| `DTM_DB_HOST`      | DB host (Docker/EKS override) | Docker, EKS |
| `DTM_DB_PORT`      | DB port (container)           | Docker, EKS |
| `DTM_DB_PORT_HOST` | DB port (host-mapped)         | Local       |
| `DTM_DB_USER`      | DB username                   | All         |
| `DTM_DB_PASSWORD`  | DB password                   | All         |

### Feature Flags

| Variable                                  | Description       | Production        |
| ----------------------------------------- | ----------------- | ----------------- |
| `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS`    | Allow test delays | **Must be false** |
| `ENABLE_DEV_ACK_SIMULATOR`                | Simulate external system ACKs | **Must be false** |
| `ENABLE_MIGRATION_REQUESTS_DEDUPLICATION` | Dedupe requests   | Recommended: true |

---

## Deployment Modes

### Mode 1: Docker (All Services in Containers)

```bash
./scripts/local-env.sh start --standalone --orchestrator
./scripts/local-env.sh deploy-workers --poller --count=5
```

**What happens:**

- Orchestrator runs in Docker container
- Connects to `dtm-db:5432` (Docker network)
- Kafka at `dtm-kafka:29092`
- LocalStack at `http://localstack:4566`

### Mode 2: Local Debug (Orchestrator on Host)

```bash
./scripts/local-env.sh start --standalone
./scripts/local-env.sh deploy-workers --debug-server
```

**What happens:**

- Orchestrator runs locally with debugger
- Connects to `localhost:5448` (host-mapped port)
- Kafka at `localhost:9093`
- LocalStack at `http://localhost:4566`
- All Lambda handlers run in-process (debuggable)

---

## EKS Deployment

For Kubernetes deployment, the app uses environment variables from ConfigMaps and Secrets:

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: orchestrator-config
data:
  NODE_ENV: "production"
  DTM_DB_HOST: "dtm-db.cluster.eu-west-1.rds.amazonaws.com"
  DTM_DB_PORT: "5432"
  DTM_DB_NAME: "dtm"
  KAFKA_BROKER: "b-1.kafka.eu-west-1.amazonaws.com:9092"
  AWS_REGION: "eu-west-1"
  ENABLE_REQUESTS_FOR_SIMULATED_DELAYS: "false"
  ENABLE_DEV_ACK_SIMULATOR: "false"
  ENABLE_MIGRATION_REQUESTS_DEDUPLICATION: "true"
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: orchestrator-secrets
type: Opaque
stringData:
  DTM_DB_USER: "dtm_app_user"
  DTM_DB_PASSWORD: "<from-aws-secrets-manager>"
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: orchestrator
spec:
  template:
    spec:
      containers:
        - name: orchestrator
          image: orchestrator:latest
          envFrom:
            - configMapRef:
                name: orchestrator-config
            - secretRef:
                name: orchestrator-secrets
```

---

## Best Practices

### 1. Never Commit Secrets

```bash
# .env is in .gitignore
# Use .env.example as the template (committed)
```

### 2. Validate at Startup

The app validates environment variables at startup using Joi:

```typescript
// Startup fails fast with clear error messages
// Example: "ENABLE_REQUESTS_FOR_SIMULATED_DELAYS must be 'false' in production"
```

### 3. Use Typed Config

```typescript
// ✅ Good - Type-safe with IntelliSense
const host = configService.get<string>("database.host");

// ❌ Avoid - No type safety
const host = process.env.DTM_DB_HOST;
```

### 4. Production Safety Checks

The validation schema enforces:

- `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false` in production
- `ENABLE_DEV_ACK_SIMULATOR=false` in production

---

## File Structure

```
.
├── .env.example              # Template (committed)
├── .env                      # Generated from example (gitignored)
└── services/orchestrator/src/
    └── config/
        ├── index.ts              # Exports all config modules
        ├── runtime.config.ts     # Runtime detection logic
        ├── database.config.ts    # Database namespace
        ├── kafka.config.ts       # Kafka namespace
        ├── aws.config.ts         # AWS namespace
        ├── app.config.ts         # App settings namespace
        └── config.validation.ts  # Joi validation schema
```

---

## Troubleshooting

### Connection Refused to Database

**Symptom:** `ECONNREFUSED localhost:5432`

**Cause:** Using wrong port for local mode

**Fix:** Runtime detection should use port 5448 for local. Check that the app is correctly detecting "local" mode.

### Kafka Connection Failed

**Symptom:** `Failed to connect to Kafka`

**Cause:** Using Docker broker address locally

**Fix:** Ensure `KAFKA_BROKER` is not hardcoded. Let runtime detection set it.

### Simulated Delays Not Working

**Symptom:** Delays specified in `testOptions` are ignored

**Cause:** `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false`

**Fix:** Set to `true` in `.env` for development/testing

---

## Switching from multi-file env

If you have legacy `.env.local`, `.env.development`, or `.env.test` files in your tree:

1. The runtime auto-detects mode (local / docker / EKS) — a single `.env` covers all three
2. Move overrides into `.env` and delete the legacy files
3. Postinstall (`scripts/setup-env.cjs`) creates `.env` from `.env.example` if absent

---

**Last Updated**: December 2024
**Maintainer**: DTM Team
