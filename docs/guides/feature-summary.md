# Feature Summary - DTM (Distributed Task Manager)

Quick reference for key production-ready features.

## Simulated Delays (Testing Feature)

**Status**: Production-Safe

### What is it?

Configurable delays for workflow steps, useful for testing, demonstrations, and performance analysis.

### Production Safety

- **Disabled by default** - Requires explicit environment variable
- **Cannot be enabled by API alone** - Must be configured in Lambda deployment
- **Two-layer protection** - Environment variable + request parameter

### Configuration

```bash
# Lambda Workers Environment (deployment script)
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false  # production (disabled)
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true   # testing/demos only
```

### Usage

```bash
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": 1,
    "testOptions": {
      "ValidateCustomer": { "simDelay": 10000 },
      "SubmitCustomer": { "simDelay": 8000 },
      "ValidateOrder": { "simDelay": 6000 },
      "SubmitOrder": { "simDelay": 4000 }
    }
  }'
```

### Default Delays

- ValidateCustomer: 10s
- SubmitCustomer: 8s
- ValidateOrder: 6s
- SubmitOrder: 4s

### Total Time (Parallel Execution)

- Phase 1 (Validate): max(10s, 6s) = **10 seconds**
- Phase 2 (Submit): max(8s, 4s) = **8 seconds**
- **Total**: ~18 seconds + overhead

---

## 🔄 Deduplication Service (Idempotency)

**Status**: ✅ Production-Ready (Configurable)

### What is it?

Unified service that prevents duplicate job requests from being processed, ensuring idempotent operations.

### Key Features

- Works for both API and Kafka-triggered jobs
- Time-based (prevents duplicates within same day)
- Context-aware matching (jobType, deduplicationKey, eventType)
- Can be enabled or disabled via environment variable

### Configuration

```bash
# Orchestrator Environment
ENABLE_DEDUPLICATION=true   # production (recommended)
ENABLE_DEDUPLICATION=false  # development/testing
```

### Behavior When Enabled

**API Requests:**

```
First Request:  200 OK - New job created
Second Request: 409 Conflict - Duplicate detected (same day)
Next Day:       200 OK - New job created (new day)
```

**Kafka Events:**

```
First Event:  Job triggered
Second Event: Skipped (duplicate logged)
Next Day:     Job triggered (new day)
```

### Behavior When Disabled

**All requests/events create new jobs** (no duplicate checking)

### Matching Rules

| Source                   | Identifier                 | Context            | Match Condition                  |
| ------------------------ | -------------------------- | ------------------ | -------------------------------- |
| API                      | customerId                 | workflowName       | Same identifier + workflow + today |
| Kafka (customer.created) | customerId                 | eventType: created | Same customerId + topic + today    |
| Kafka (customer.updated) | customerId                 | eventType: updated | Same customerId + topic + today    |

---

## Environment Configuration Matrix

| Feature              | Local Dev | Docker Dev | Testing | Production |
| -------------------- | --------- | ---------- | ------- | ---------- |
| **Deduplication**    | `false`   | `false`    | `false` | `true`     |
| **Simulated Delays** | `false`   | `false`    | `false` | `false`    |

---

## Quick Testing

### Test Simulated Delays

```bash
# 1. Enable in environment
export ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true

# 2. Redeploy workers
./scripts/local-env.sh deploy-workers

# 3. Test with custom delays
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" \
  -d '{"customerId": 1, "testOptions": {"ValidateCustomer": {"simDelay": 5000}}}'
```

### Test Deduplication

```bash
# 1. Enable in environment
export ENABLE_DEDUPLICATION=true

# 2. Restart orchestrator
docker compose restart orchestrator

# 3. Send duplicate requests
curl -X POST "http://localhost:3002/api/v1/workflows/order-processing/jobs" \
  -H "Content-Type: application/json" -d '{"customerId": 1}'

# First: 200 OK
# Second (same day): 409 Conflict
```

---

## Production Deployment Checklist

### Feature Configuration

- [ ] Set `ENABLE_DEDUPLICATION=true`
- [ ] Set `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false` (or omit)
- [ ] Configure Kafka event flags
- [ ] Set production webhook URLs

### Verification

- [ ] Verify simulated delays are disabled (test API request)
- [ ] Verify deduplication works (test duplicate request)
- [ ] Verify Kafka event deduplication
- [ ] Monitor CloudWatch logs for security warnings

### Monitoring

- [ ] Set up alerts for high 409 Conflict rate
- [ ] Monitor deduplication effectiveness
- [ ] Track job completion times
- [ ] Monitor Lambda execution times

---

## Documentation

**Full Documentation**: [../FEATURES.md](../FEATURES.md)

**Quick Links:**

- [Main README](../../README.md) - Project overview and quick start
- [Architecture Diagram](../diagrams/architecture-detailed.mermaid) - Visual system design
- [Environment Files](../ENV-FILES-USAGE.md) - Environment configuration guide
- [API Documentation](http://localhost:3000/api-docs) - Swagger UI (when running)

---

## Support

For questions or issues:

1. Review [FEATURES.md](docs/FEATURES.md) for detailed documentation
2. Check [Troubleshooting Guide](docs/troubleshooting.md) (if available)
3. Review API documentation at http://localhost:3000/api-docs
4. Check CloudWatch logs for Lambda workers
5. Query `dtm_jobs` table for job history
