# Retry-Aware Failure Simulation - Testing Examples

Quick reference for testing retry scenarios in presentations and demos.

## Prerequisites

```bash
# Ensure feature flag is enabled in .env.development
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true

# Start services
./scripts/local-env.sh start

# Deploy workers (if not already deployed)
./scripts/local-env.sh deploy-workers
```

---

## 🎯 Scenario 1: Transient Failure (Perfect for Demos)

**Use Case:** Show that system automatically recovers from temporary failures.

```bash
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "ValidateCustomer": {
        "simDelay": 3000,
        "failureAfter": 2000,
        "failOnAttempts": [1]
      }
    }
  }'
```

**Expected Behavior:**

- **0-2s**: ValidateCustomer processes
- **2s**: Fails with simulated error
- **~5s**: SQS automatically retries
- **5-8s**: ValidateCustomer retry (attempt #2)
- **8s**: Succeeds (not in failOnAttempts)
- Job completes successfully

**What to Show:**

- CloudWatch logs showing "Attempt 1" failure
- CloudWatch logs showing "Attempt 2" success
- Dashboard showing step eventually completes
- No manual intervention required

---

## 🎯 Scenario 2: Multiple Retries Required

**Use Case:** Demonstrate resilience with multiple transient failures.

```bash
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "SubmitCustomer": {
        "simDelay": 2000,
        "failureAfter": 1000,
        "failOnAttempts": [1, 2]
      }
    }
  }'
```

**Expected Behavior:**

- ❌ Attempt 1: Fails at 1s
- ❌ Attempt 2: Fails at 1s
- ✅ Attempt 3: Succeeds after 2s
- Total time: ~6-7s (with SQS retry delays)

**What to Show:**

- System retries twice automatically
- Each retry is logged with attempt number
- Third attempt succeeds without changes
- Demonstrates SQS reliability

---

## 🎯 Scenario 3: Permanent Failure (DLQ Testing)

**Use Case:** Show what happens when retries are exhausted.

```bash
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "ValidateOrder": {
        "failureAfter": 500,
        "failOnAttempts": [1, 2, 3, 4, 5]
      }
    }
  }'
```

**Expected Behavior:**

- ❌ All attempts fail (1-5 or until maxRetryCount)
- 📬 Message moves to Dead Letter Queue
- 🚫 Job marked as FAILED
- ⏭️ Dependent steps marked as SKIPPED

**What to Show:**

- Retry exhaustion handling
- DLQ monitoring
- Job failure alerting
- Graceful degradation (other steps don't run)

---

## 🎯 Scenario 4: Complex Parallel Retry Demo (WOW Factor)

**Use Case:** Ultimate demo showing parallel execution with mixed retry scenarios.

```bash
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "ValidateCustomer": {
        "simDelay": 5000,
        "failureAfter": 3000,
        "failOnAttempts": [1]
      },
      "ValidateOrder": {
        "simDelay": 3000,
        "failureAfter": 2000,
        "failOnAttempts": [1, 2]
      },
      "SubmitCustomer": {
        "simDelay": 4000,
        "ackDelay": 5000
      },
      "SubmitOrder": {
        "simDelay": 2000,
        "ackDelay": 3000
      }
    }
  }'
```

**Timeline (~30-35 seconds total):**

| Time | Event                                         |
| ---- | --------------------------------------------- |
| 0s   | Both Validate steps start in parallel         |
| 2s   | ValidateOrder fails (attempt 1)               |
| 3s   | ValidateCustomer fails (attempt 1)            |
| ~5s  | ValidateOrder retry starts (attempt 2)        |
| ~7s  | ValidateOrder fails again (attempt 2)         |
| ~8s  | ValidateCustomer retry succeeds               |
| ~10s | ValidateOrder retry starts (attempt 3)        |
| ~13s | ValidateOrder succeeds                        |
| 13s  | Both Submit steps start in parallel           |
| ~17s | SubmitCustomer completes -> Kafka publish     |
| ~15s | SubmitOrder completes -> Kafka publish         |
| ~22s | Customer ack received (5s delay)              |
| ~18s | Order ack received (3s delay)                 |
| ~22s | Job COMPLETED                                 |

**What to Show:**

- ✨ Parallel execution with failures
- ✨ Independent retry behaviors
- ✨ Orchestration waits for all steps
- ✨ Acknowledgement workflow
- ✨ Complete resilience story

---

## 🎯 Scenario 5: Quick Transient Test (Under 10s)

**Use Case:** Fast demo for time-constrained presentations.

```bash
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "ValidateCustomer": {
        "simDelay": 2000,
        "failureAfter": 1000,
        "failOnAttempts": [1]
      },
      "ValidateOrder": { "simDelay": 1000 },
      "SubmitCustomer": { "simDelay": 1000, "ackDelay": 2000 },
      "SubmitOrder": { "simDelay": 1000, "ackDelay": 1000 }
    }
  }'
```

**Total Time:** ~8-10 seconds
**Shows:** Basic retry + acknowledgement flow

---

## 📊 Monitoring Commands

**Watch Job Status:**

```bash
# Get job ID from response, then:
curl "http://localhost:3002/api/v1/jobs/{jobId}" | jq
```

**Watch CloudWatch Logs:**

```bash
# ValidateCustomer worker
aws --endpoint-url=http://localhost:4567 logs tail /aws/lambda/validate-customer-worker --follow

# All workers
./scripts/local-env.sh logs-workers
```

**Query Database:**

```sql
-- See retry attempts
SELECT
  step_value,
  status,
  retry_count,
  execution_history
FROM dtm_steps
WHERE job_id = 'your-job-id'
ORDER BY step_value;

-- See WAITING_FOR_ACK status
SELECT
  step_value,
  status,
  kafka_published_at,
  ack_received_at,
  EXTRACT(EPOCH FROM (ack_received_at - kafka_published_at)) as ack_wait_seconds
FROM dtm_steps
WHERE job_id = 'your-job-id'
  AND status IN ('WAITING_FOR_ACK', 'COMPLETED');
```

**Watch Kafka Topics:**

```bash
# Acknowledgements
docker exec -it dtm-kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic order.consumer.ack \
  --from-beginning

# Completed events
docker exec -it dtm-kafka kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic dtm.jobs.completed \
  --from-beginning
```

---

## 🎬 Presentation Tips

1. **Start Simple**: Begin with Scenario 1 (single transient failure)
2. **Build Complexity**: Progress to Scenario 2 (multiple retries)
3. **Show Edge Cases**: Demonstrate Scenario 3 (permanent failure/DLQ)
4. **Grand Finale**: End with Scenario 4 (complex parallel demo)

**Key Talking Points:**

- ✅ Zero configuration retries (SQS built-in)
- ✅ Parallel execution continues despite failures
- ✅ Complete observability at every step
- ✅ Automatic recovery without manual intervention
- ✅ Production-ready resilience patterns

---

## 🔒 Production Safety

**These features are SAFE for production:**

```bash
# Production .env (simulated features disabled)
NODE_ENV=production
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false  # ← Must be false
ENABLE_DEV_ACK_SIMULATOR=false              # ← Must be false or omitted
```

When disabled:

- ❌ No delay simulation
- ❌ No failure simulation
- ❌ No retry simulation
- ❌ No ack simulation
- ✅ **Zero performance impact**
- ✅ **Zero security risk**

Real production behavior:

- ✅ Normal SQS retry behavior applies
- ✅ Real external system acknowledgements required
- ✅ Actual processing times
- ✅ Real error handling

---

## 🐛 Troubleshooting

**Simulated failures not working?**

```bash
# Check environment variable
docker exec orchestrator env | grep ENABLE_REQUESTS_FOR_SIMULATED_DELAYS
# Should output: ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true

# Redeploy workers if needed
./scripts/local-env.sh deploy-workers
```

**Acknowledgements not coming through?**

```bash
# Check dev ack simulator is enabled
docker logs orchestrator 2>&1 | grep "Dev Acknowledgement Simulator"
# Should see: "🤖 Dev Acknowledgement Simulator ENABLED"
```

**Worker not retrying?**

```bash
# Check SQS visibility timeout and maxReceiveCount
aws --endpoint-url=http://localhost:4567 sqs get-queue-attributes \
  --queue-url http://localhost:4567/000000000000/order-validate-customer \
  --attribute-names All
```

---

## 📚 Further Reading

### Documentation

- [FEATURES.md](./docs/FEATURES.md) - Complete feature documentation
- [README.md](./README.md) - Project overview
- [PRODUCTION-DATA-ANALYSIS.md](./PRODUCTION-DATA-ANALYSIS.md) - Data considerations

### Visual Diagrams

- [System Architecture Guide](./docs/system-architecture.md) ⭐⭐⭐ - Complete architecture in 8 component diagrams with detailed explanations
- [Job Scenarios Guide](./docs/migration-scenarios.md) ⭐⭐⭐ - 8 execution scenarios with embedded diagrams, configs, and monitoring commands
- [Detailed Architecture](./docs/architecture-detailed.mermaid) - Single comprehensive diagram

**Tip:**

- Use [Job Scenarios Guide](./docs/migration-scenarios.md) for **presentations** - shows what happens with each config
- Use [System Architecture Guide](./docs/system-architecture.md) for **onboarding** - explains how everything works
