# Deployment Modes Guide

This guide explains the two execution modes available for Lambda workers in DTM.

## Table of Contents

1. [Overview](#overview)
2. [ESM Mode (Parallel Execution)](#esm-mode-parallel-execution)
3. [Poller Mode (Sequential Execution)](#poller-mode-sequential-execution)
4. [Comparison](#comparison)
5. [How to Choose](#how-to-choose)
6. [Switching Modes](#switching-modes)
7. [Troubleshooting](#troubleshooting)

---

> **ESM mode is DISABLED by default.**
>
> The free LocalStack version exhibits flaky behavior with ESM v2: race conditions between
> ESM polling and poller containers, container auto-restart conflicts, and mixed-mode issues.
> All local development and testing uses **Poller mode** exclusively.
>
> To explicitly enable ESM mode, set the environment variable before deploying:
> ```bash
> export ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT=true
> ```
> This is only recommended with a LocalStack Pro license.

---

## Overview

DTM supports two execution modes for Lambda workers, each with different characteristics:

- **ESM Mode**: Parallel execution using LocalStack's native Event Source Mappings (ESM v2)
- **Poller Mode**: Sequential execution using a custom SQS poller container

Both modes deploy the same Lambda functions but differ in how messages are processed from SQS queues.

### ⚠️ Important Note: Acknowledgement Handling

**Current State:**

- The `dev-ack-simulator` service runs in **BOTH standalone and integrated modes**
- This is a **temporary solution** until external system implements the acknowledgement service

**Future State:**

- **Standalone Mode**: Will continue to use `dev-ack-simulator` for development
- **Integrated Mode**: Will receive real acknowledgements from external system
- The `dev-ack-simulator` will only run in standalone/local development environments

The dev-ack-simulator is a fully independent service that listens to `dtm.jobs.completed` Kafka topics and automatically publishes acknowledgements to `dtm.*.ack` topics. For more details, see [tools/dev-ack-simulator/README.md](../tools/dev-ack-simulator/README.md).

---

## ESM Mode (Parallel Execution)

### What It Is

ESM (Event Source Mapping) mode uses LocalStack's native AWS Lambda Event Source Mapping v2 feature to enable parallel execution of Lambda functions. Up to 50 Lambda containers can run simultaneously.

**⚡ Performance:**

- **Lambda Timeout**: 15 seconds (dev/test), configurable (production)
- **SQS Visibility**: 30 seconds (dev/test), 360 seconds (production)
- **MaxConcurrency**: 50 simultaneous Lambda invocations
- **Retry Timing**: 30-second visibility timeout = 3x faster retries!

### When to Use

- ✅ E2E testing (especially concurrent jobs)
- ✅ Load testing
- ✅ Production-like environments
- ✅ When you need faster execution
- ✅ Testing parallel execution scenarios

### How to Deploy

```bash
# Start LocalStack
./scripts/local-env.sh start --standalone --orchestrator

# Enable ESM mode (requires LocalStack Pro)
export ENABLE_LAMBDA_WITH_ESM_LOCALSTACK_DEPLOYMENT=true

# Deploy in ESM mode
./scripts/local-env.sh deploy-workers --esm
```

### What Happens

1. **Lambda Functions Deployed**: 4 workers built and deployed to LocalStack
2. **ESMs Created Automatically**: Event Source Mappings created for each queue-worker pair
3. **Concurrency Configured**: `MaximumConcurrency=50` set on each ESM
4. **Parallel Polling**: LocalStack's ESM v2 polls multiple messages simultaneously
5. **Container Per Invocation**: Each Lambda invocation gets its own Docker container
6. **Fast Timeouts**: 15s Lambda timeout, 30s SQS visibility (3x faster retries!)

### Configuration

**LocalStack Settings:**

```yaml
LAMBDA_RUNTIME_EXECUTOR: docker # New container per invocation
LAMBDA_EVENT_SOURCE_MAPPING: v2 # Enable ESM v2 with parallelism
LAMBDA_REMOVE_CONTAINERS: true # Clean up after execution
```

**ESM Settings (applied automatically):**

- `BatchSize`: 1 (process one message per invocation)
- `MaximumConcurrency`: 50 (up to 50 parallel executions)
- `Timeout`: 15 seconds (dev/test), configurable (production)

### Monitoring

**Verify ESMs are created:**

```bash
aws --endpoint-url=http://localhost:4566 lambda list-event-source-mappings --region us-east-1
```

**Watch parallel Lambda containers:**

```bash
watch -n 0.5 "docker ps | grep lambda"

# You should see multiple lambda containers running at once:
# lambda-order-validate-customer-abc123
# lambda-order-validate-order-def456
# lambda-order-submit-customer-ghi789
```

**Check ESM status:**

```bash
aws --endpoint-url=http://localhost:4566 lambda list-event-source-mappings \
  --region us-east-1 \
  --query 'EventSourceMappings[*].[FunctionArn, State, ScalingConfig.MaximumConcurrency]' \
  --output table
```

### Pros

✅ **High parallelism** - Up to 50 Lambdas run simultaneously
✅ **Faster processing** - Concurrent jobs complete much faster  
✅ **Production-like** - Simulates AWS Lambda auto-scaling  
✅ **Automatic setup** - ESMs created automatically during deployment  
✅ **E2E test ready** - Perfect for concurrent job tests
✅ **Fast retries** - 30s SQS visibility = 3x faster than old 90s config

### Cons

⚠️ **More complex** - More moving parts (ESMs, multiple containers)  
⚠️ **Resource intensive** - Multiple Docker containers running  
⚠️ **Harder to debug** - Parallel logs can be confusing  
⚠️ **LocalStack specific** - Behavior may differ slightly from real AWS

---

## Poller Mode (Sequential Execution)

### What It Is

Poller mode uses a custom SQS poller container that continuously polls SQS queues and invokes Lambda functions sequentially. Only one message is processed at a time.

### When to Use

- ✅ Local development
- ✅ Debugging specific issues
- ✅ Following execution flow step-by-step
- ✅ Simpler setup and monitoring
- ✅ When you don't need parallel execution

### How to Deploy

```bash
# Start LocalStack
./scripts/local-env.sh start --standalone --orchestrator

# Deploy in Poller mode
./scripts/local-env.sh deploy-workers --poller
```

### What Happens

1. **Lambda Functions Deployed**: 4 workers built and deployed to LocalStack
2. **Poller Container Started**: Custom SQS poller container starts automatically
3. **Sequential Polling**: Poller fetches one message at a time from SQS queues
4. **Lambda Invocation**: Poller invokes corresponding Lambda function
5. **Message Deletion**: Poller deletes message from queue after successful processing

### Configuration

**Poller Settings:**

```yaml
POLL_INTERVAL_MS: 1000 # Poll every 1 second
MAX_MESSAGES_PER_POLL: 1 # Fetch 1 message at a time
WAIT_TIME_SECONDS: 5 # Long polling (reduces API calls)
```

**LocalStack Settings:**

```yaml
LAMBDA_RUNTIME_EXECUTOR: docker # Same as ESM mode
LAMBDA_EVENT_SOURCE_MAPPING: v2 # Enabled but not used
```

### Monitoring

**Verify poller is running:**

```bash
docker ps | grep sqs-poller

# Expected output:
# dtm-sqs-poller-1   Up   ...
```

**View poller logs:**

```bash
docker logs -f dtm-sqs-poller-1

# You'll see:
# - Queue polling activity
# - Lambda invocations
# - Message processing
# - Errors and retries
```

**Check poller status:**

```bash
docker inspect dtm-sqs-poller-1 --format '{{.State.Status}}'
```

### Pros

✅ **Simple** - One container, easy to understand  
✅ **Sequential** - Predictable execution order  
✅ **Easy to debug** - Clear logs, one thing at a time  
✅ **Familiar** - Similar to traditional queue workers  
✅ **Stable** - Well-tested, reliable pattern

### Cons

⚠️ **Slower** - One message at a time  
⚠️ **Not production-like** - AWS doesn't work this way  
⚠️ **Sequential only** - Can't test parallel scenarios  
⚠️ **Extra container** - Additional resource overhead

---

## Comparison

| Feature               | ESM Mode                       | Poller Mode               |
| --------------------- | ------------------------------ | ------------------------- |
| **Execution**         | Parallel (up to 50)            | Sequential (1 at a time)  |
| **Lambda Timeout**    | 15s (dev/test)                 | 15s (dev/test)            |
| **SQS Visibility**    | 30s (dev/test)                 | 30s (dev/test)            |
| **Retry Timing**      | 30s (3x faster!)               | 30s (3x faster!)          |
| **Speed**             | Much faster (high concurrency) | Slower (sequential)       |
| **Complexity**        | More complex                   | Simpler                   |
| **Debugging**         | Harder (parallel logs)         | Easier (sequential logs)  |
| **Production-like**   | Yes (simulates AWS)            | No (custom solution)      |
| **E2E Testing**       | ✅ Recommended                 | ⚠️ Limited                |
| **Development**       | ✅ Fast                        | ✅ Simple                 |
| **Resource Usage**    | Higher (multiple containers)   | Lower (1 poller)          |
| **Setup**             | Automatic (ESMs created)       | Automatic (poller starts) |
| **Mode Switching**    | ~5 seconds                     | ~5 seconds                |
| **AWS Compatibility** | High                           | Low                       |

---

## How to Choose

### Use ESM Mode When:

- 🎯 Running E2E tests (especially `10-concurrent-migrations`)
- 🎯 Load testing the system
- 🎯 Demonstrating parallel execution capabilities
- 🎯 Testing race conditions or concurrent scenarios
- 🎯 Preparing for production deployment
- 🎯 You need the fastest execution time

### Use Poller Mode When:

- 🎯 Developing new features
- 🎯 Debugging specific issues
- 🎯 Learning how the system works
- 🎯 Following execution flow step-by-step
- 🎯 Running on resource-constrained machines
- 🎯 You prefer simpler logs and monitoring

### Default Recommendations

```bash
# For E2E testing (CI/CD, validation)
./scripts/local-env.sh deploy-workers --esm

# For local development (feature work, debugging)
./scripts/local-env.sh deploy-workers --poller
```

---

## Switching Modes

### ⚡ **SEAMLESS MODE SWITCHING** (No Infrastructure Restart!) **NEW**

You can now switch between modes **without stopping any infrastructure**:

```bash
# Switch from ESM → Poller (5 seconds)
./scripts/local-env.sh deploy-workers --poller

# Switch from Poller → ESM (5 seconds)
./scripts/local-env.sh deploy-workers --esm
```

**What Stays Running:**

- ✅ DTM database
- ✅ Workflow source databases
- ✅ Orchestrator
- ✅ Front-end
- ✅ Dev Ack Simulator
- ✅ LocalStack
- ✅ Kafka
- ✅ **All jobs and data preserved!**

**What Changes:**

- 🔄 Lambda functions (redeployed)
- 🔄 ESMs (created/deleted)
- 🔄 SQS poller (started/stopped)

**Time:** ~5 seconds (vs ~60 seconds for full restart!)

---

### How It Works

#### From ESM to Poller:

```bash
./scripts/local-env.sh deploy-workers --poller
```

**Automatic Steps:**

1. ✅ Detects 4 existing ESMs
2. ⚠️ Removes all ESMs (no longer needed)
3. ⏳ Waits 3 seconds (LocalStack stabilization)
4. 🔄 Redeploys Lambda functions (with retry logic)
5. ▶️ Starts SQS poller container
6. ✅ Done! (~5 seconds total)

**Output:**

```
📦 Deploying Lambda Workers
Mode: Poller (sequential execution via custom SQS poller)

ℹ️  Checking for existing ESMs...
⚠️  Found 4 ESM(s) - removing them (switching to poller mode)...
✅  ESMs removed

ℹ️  Waiting 3 seconds for LocalStack to stabilize...
✅  Ready to deploy

ℹ️  Deploying Lambda workers to LocalStack...
  🔄 order-validate-customer [DB] (updated)
  🔄 order-validate-product [DB] (updated)
  🔄 order-submit-customer [PROCESSING] (updated)
  🔄 order-submit-order [PROCESSING] (updated)

→ Starting custom SQS poller...
✅ SQS poller started

🎉 Deployment complete!
```

#### From Poller to ESM:

```bash
./scripts/local-env.sh deploy-workers --esm
```

**Automatic Steps:**

1. ✅ Detects running SQS poller
2. ⚠️ Stops and removes poller container
3. 🔄 Redeploys Lambda functions (with retry logic)
4. ✅ Creates 4 ESMs (MaxConcurrency=50 each)
5. ✅ Done! (~5 seconds total)

**Output:**

```
📦 Deploying Lambda Workers
Mode: ESM (parallel execution via LocalStack ESM v2)

⚠️  Found running SQS poller - stopping it (switching to ESM mode)...
✅  SQS poller stopped

ℹ️  Deploying Lambda workers to LocalStack...
  🔄 order-validate-customer [DB] (updated)
  🔄 order-validate-product [DB] (updated)
  🔄 order-submit-customer [PROCESSING] (updated)
  🔄 order-submit-order [PROCESSING] (updated)

✅  ESM mode configured (native LocalStack polling)

🎉 Deployment complete!
```

---

### Verification

After switching modes:

```bash
# Check current mode
# ESM Mode:
aws --endpoint-url=http://localhost:4566 lambda list-event-source-mappings --region us-east-1 | jq '.EventSourceMappings | length'
# Output: 4 (ESM mode) or 0 (poller mode)

# Poller Mode:
docker ps | grep sqs-poller
# Output: Container running (poller mode) or nothing (ESM mode)
```

---

### ⚠️ Troubleshooting Mode Switching

#### ResourceConflictException During Switch

**Symptom:**

```
An error occurred (ResourceConflictException) when calling the
UpdateFunctionConfiguration operation: The operation cannot be performed
at this time. An update is in progress
```

**Cause:**

- Race condition: ESM deletion triggers Lambda update
- Script tries to update Lambda before ESM cleanup finishes

**Solution:**
The script now includes:

1. ✅ **3-second wait** after ESM deletion (handles 99% of cases)
2. ✅ **Automatic retries** in deploy script (handles edge cases)
3. ✅ **Retry logic**: 3 attempts with 2-second delays

**If it still fails:**

```bash
# Wait 10 seconds and try again
sleep 10
./scripts/local-env.sh deploy-workers --poller
```

---

### Old Method (Full Restart) - No Longer Needed

```bash
# ❌ OLD WAY (Don't do this unless absolutely necessary)
./scripts/local-env.sh stop
./scripts/local-env.sh start --standalone --orchestrator
./scripts/local-env.sh deploy-workers --esm

# Time: ~60 seconds
# Data loss: Possible
```

```bash
# ✅ NEW WAY (Recommended)
./scripts/local-env.sh deploy-workers --esm

# Time: ~5 seconds (12x faster!)
# Data loss: None ✅
```

---

## Troubleshooting

### ESM Mode Issues

#### ESMs Not Created

**Symptom:** No Event Source Mappings exist

**Check:**

```bash
aws --endpoint-url=http://localhost:4566 lambda list-event-source-mappings --region us-east-1

# Expected: 4 ESMs
# Actual: Empty EventSourceMappings array
```

**Solution:**

```bash
# Redeploy in ESM mode
./scripts/local-env.sh deploy-workers --esm
```

#### No Parallel Execution

**Symptom:** Only one Lambda runs at a time despite ESM mode

**Check:**

```bash
# 1. Verify ESMs have correct concurrency
aws --endpoint-url=http://localhost:4566 lambda list-event-source-mappings \
  --region us-east-1 \
  --query 'EventSourceMappings[*].ScalingConfig.MaximumConcurrency'

# Expected: [50, 50, 50, 50]

# 2. Check LocalStack configuration
docker exec dtm-localstack env | grep LAMBDA

# Expected:
# LAMBDA_RUNTIME_EXECUTOR=docker
# LAMBDA_EVENT_SOURCE_MAPPING=v2
```

**Solution:**

```bash
# Restart environment with correct config
./scripts/local-env.sh stop
./scripts/local-env.sh start --standalone --orchestrator
./scripts/local-env.sh deploy-workers --esm
```

#### Lambda Containers Not Showing

**Symptom:** `docker ps | grep lambda` shows nothing during execution

**Check:**

```bash
# 1. Send a test job
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{"deduplicationKey": "test-123", "variant": "full-order", "payload": {"customerId": 1, "orderId": 1}}'

# 2. Immediately check containers
docker ps | grep lambda

# 3. Check LocalStack logs
docker logs ${COMPOSE_PROJECT_NAME:-dtm}-localstack | grep -i lambda
```

**Solution:**

- Containers may be too fast to see (they spin up and down quickly)
- Use `watch -n 0.5 "docker ps | grep lambda"` for real-time monitoring
- Send concurrent jobs to see multiple containers

---

### Poller Mode Issues

#### Poller Not Running

**Symptom:** No `sqs-poller` container

**Check:**

```bash
docker ps | grep sqs-poller

# Expected: dtm-sqs-poller-1 container
# Actual: Nothing
```

**Solution:**

```bash
# Redeploy in Poller mode
./scripts/local-env.sh deploy-workers --poller

# Verify poller started
docker ps | grep sqs-poller
```

#### Poller Crashing

**Symptom:** Poller container restarts repeatedly

**Check:**

```bash
# View poller logs
docker logs dtm-sqs-poller-1

# Check for errors
docker logs dtm-sqs-poller-1 2>&1 | grep -i error
```

**Common causes:**

- LocalStack not ready (wait for LocalStack healthcheck)
- Network issues (verify `dtm` network)
- Configuration errors (check environment variables)

**Solution:**

```bash
# Restart poller
docker restart dtm-sqs-poller-1

# Or redeploy
./scripts/local-env.sh deploy-workers --poller
```

#### Messages Not Being Processed

**Symptom:** Messages stuck in SQS queues

**Check:**

```bash
# 1. Verify poller is polling
docker logs dtm-sqs-poller-1 | tail -n 20

# 2. Check SQS queue depths
./scripts/local-env.sh monitor sqs

# 3. Verify Lambda functions exist
aws --endpoint-url=http://localhost:4566 lambda list-functions --region us-east-1 --query 'Functions[*].FunctionName'
```

**Solution:**

```bash
# Restart poller
docker restart dtm-sqs-poller-1

# Or check Lambda function logs
aws --endpoint-url=http://localhost:4566 logs tail /aws/lambda/order-validate-customer --region us-east-1 --follow
```

---

### General Issues

#### Wrong Mode Active

**Symptom:** Expected parallel but got sequential (or vice versa)

**Check:**

```bash
# Check if poller is running (indicates Poller mode)
docker ps | grep sqs-poller

# Check if ESMs exist (indicates ESM mode)
aws --endpoint-url=http://localhost:4566 lambda list-event-source-mappings --region us-east-1
```

**Solution:**
Redeploy in the correct mode:

```bash
./scripts/local-env.sh deploy-workers --esm   # or --poller
```

#### Deployment Failed

**Symptom:** `deploy-workers` command failed

**Check:**

```bash
# 1. Verify LocalStack is running
docker ps | grep localstack

# 2. Check LocalStack health
curl http://localhost:4566/_localstack/health

# 3. Check docker-compose logs
docker compose -f docker-compose.workers.yml logs localstack
```

**Solution:**

```bash
# Start LocalStack if not running
./scripts/local-env.sh start --standalone

# Redeploy
./scripts/local-env.sh deploy-workers --esm  # or --poller
```

---

## See Also

- **[REFACTORING-COMPLETE.md](../REFACTORING-COMPLETE.md)** - Complete refactoring guide with verification steps
- **[Main README](../README.md)** - Quick start and overview
- **[E2E-CONCURRENCY-SOLUTION.md](../E2E-CONCURRENCY-SOLUTION.md)** - LocalStack concurrency details
- **[system-architecture.md](system-architecture.md)** - System architecture guide

---

## Quick Reference

```bash
# ESM Mode (Parallel)
./scripts/local-env.sh deploy-workers --esm
watch -n 0.5 "docker ps | grep lambda"

# Poller Mode (Sequential)
./scripts/local-env.sh deploy-workers --poller
docker logs -f dtm-sqs-poller-1

# Verify Mode
docker ps | grep sqs-poller                        # Poller mode if present
awslocal lambda list-event-source-mappings        # ESM mode if not empty

# Switch Modes
./scripts/local-env.sh deploy-workers --esm        # Switch to ESM
./scripts/local-env.sh deploy-workers --poller     # Switch to Poller
```

---

## Summary

- **ESM Mode**: Parallel execution, production-like, best for E2E tests
- **Poller Mode**: Sequential execution, simpler, best for development
- **Easy Switching**: Just redeploy with `--esm` or `--poller` flag
- **Both Valid**: Choose based on your current task

🎉 **Happy orchestrating!**
