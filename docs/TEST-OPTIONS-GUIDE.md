# Test Options Guide

## Overview

`testOptions` is a powerful mechanism for controlling worker behavior during testing and demonstrations. It allows you to:

- **Simulate delays** - Control execution timing for demos or timing-sensitive tests
- **Simulate failures** - Test retry logic, DLQ routing, and error handling
- **Enable feature flags** - Toggle experimental features for testing

**Security:** Test options are only respected when `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true` is set in the worker environment. This prevents abuse in production environments.

---

## Table of Contents

1. [Security Model](#security-model)
2. [Simulated Delays](#simulated-delays)
3. [Simulated Failures](#simulated-failures)
4. [Usage in E2E Tests](#usage-in-e2e-tests)
5. [Best Practices](#best-practices)
6. [Reference Tables](#reference-tables)

---

## Security Model

### Environment Variable

```bash
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
```

**When enabled:**
- Workers respect `testOptions` in request payloads
- Delays and failures can be simulated
- Useful for development and E2E testing

**When disabled (default):**
- Workers ignore all `testOptions`
- No delays or failures are simulated
- Production-safe behavior

### Validation

All delays are validated against Lambda timeout limits:

```typescript
const MAX_SAFE_DELAY_MS = 13000; // 13 seconds (2s buffer for 15s Lambda timeout)

if (delayMs > MAX_SAFE_DELAY_MS) {
  throw new Error('Delay exceeds maximum safe limit');
}
```

---

## Simulated Delays

### Purpose

- **Demonstration:** Show step-by-step progress in demos
- **Timing Tests:** Test race conditions, timeouts, and timing-sensitive logic
- **Load Testing:** Simulate slow external systems

### Configuration

Add delays to any step in the job payload:

```json
{
  "customerId": 1,
  "orderId": 1,
  "testOptions": {
    "ValidateCustomer": { "simDelay": 2000 },
    "ValidateOrder": { "simDelay": 1500 },
    "SubmitCustomer": { "simDelay": 1000 },
    "SubmitOrder": { "simDelay": 1000 }
  }
}
```

### Available Delay Options (Order-Processing Example)

| Option | Worker | Description |
|--------|--------|-------------|
| `ValidateCustomer` | ValidateCustomer | Delay before validating customer data from workflow source DB |
| `ValidateOrder` | ValidateOrder | Delay before validating order data from workflow source DB |
| `SubmitCustomer` | SubmitCustomer | Delay before submitting customer data |
| `SubmitOrder` | SubmitOrder | Delay before submitting order data |

### Example: Demo Mode

Show clear step progression in a demo:

```json
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 3000 },
    "ValidateOrder": { "simDelay": 3000 },
    "SubmitCustomer": { "simDelay": 2000 },
    "SubmitOrder": { "simDelay": 2000 }
  }
}
```

**Result:** Each step takes a few seconds, making the orchestration flow visible.

---

## Simulated Failures

### Purpose

- **Retry Logic:** Test SQS retry mechanisms (max 3 attempts)
- **DLQ Routing:** Verify messages route to DLQ after retry exhaustion
- **Error Handling:** Test failure callbacks and status updates
- **Recovery:** Test partial failures (one step fails, others succeed)

### Three Usage Patterns

#### Pattern 1: Fail Specific Attempts Immediately ✨ **Recommended**

```json
{
  "testOptions": {
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}
```

**Behavior:** Fails immediately on attempts 1, 2, 3 → exhausts retries → DLQ

**Use Case:** Test retry exhaustion and DLQ routing

**Why Recommended:** Simplest syntax, no delay needed, fast test execution

---

#### Pattern 2: Fail Specific Attempts With Delay

```json
{
  "testOptions": {
    "SubmitOrder": { "failureAfter": 100, "failOnAttempts": [1, 2] }
  }
}
```

**Behavior:** Waits 100ms, then fails on attempts 1 & 2 → succeeds on attempt 3

**Use Case:** Test retry recovery with timing constraints

**When to Use:** Testing race conditions or timing-sensitive error recovery

---

#### Pattern 3: Fail All Attempts With Delay

```json
{
  "testOptions": {
    "SubmitOrder": { "failureAfter": 100 }
  }
}
```

**Behavior:** Waits 100ms, then fails on ALL attempts → exhausts retries → DLQ

**Use Case:** Test delayed failures on all retries

**When to Use:** Simulating slow operations that eventually fail

---

### Available Failure Options (Order-Processing Example)

| Option Pattern | Worker | Description |
|---------------|--------|-------------|
| `ValidateCustomer.failOnAttempts` | ValidateCustomer | Specify which attempts should fail (array) |
| `ValidateCustomer.failureAfter` | ValidateCustomer | Delay before throwing error (ms, optional) |
| `ValidateOrder.failOnAttempts` | ValidateOrder | Specify which attempts should fail (array) |
| `ValidateOrder.failureAfter` | ValidateOrder | Delay before throwing error (ms, optional) |
| `SubmitCustomer.failOnAttempts` | SubmitCustomer | Specify which attempts should fail (array) |
| `SubmitCustomer.failureAfter` | SubmitCustomer | Delay before throwing error (ms, optional) |
| `SubmitOrder.failOnAttempts` | SubmitOrder | Specify which attempts should fail (array) |
| `SubmitOrder.failureAfter` | SubmitOrder | Delay before throwing error (ms, optional) |

---

### Failure Examples

#### Example 1: Test Retry Recovery

```json
{
  "testOptions": {
    "SubmitCustomer": { "failOnAttempts": [1] }
  }
}
```

**Timeline:**
- Attempt 1: Fails immediately
- Attempt 2: Succeeds
- Job status: Completed

---

#### Example 2: Test Partial Failure

```json
{
  "testOptions": {
    "SubmitCustomer": { "failOnAttempts": [1, 2, 3] }
  }
}
```

**Timeline:**
- SubmitCustomer: Fails on all 3 attempts → DLQ
- SubmitOrder: Succeeds
- Job status: Failed (one step failed)

---

#### Example 3: Test Complete Failure

```json
{
  "testOptions": {
    "SubmitCustomer": { "failOnAttempts": [1, 2, 3] },
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}
```

**Timeline:**
- SubmitCustomer: Exhausts retries → DLQ
- SubmitOrder: Exhausts retries → DLQ
- Job status: Failed (all steps failed)

---

## Usage in E2E Tests

### Basic Template

```bash
#!/bin/bash
source "$SCRIPT_DIR/../shared/helpers.sh"

# Test configuration
CUSTOMER_ID=1
ORDER_ID=1

# Create payload with test options
PAYLOAD=$(cat <<EOF
{
  "customerId": $CUSTOMER_ID,
  "orderId": $ORDER_ID,
  "externalSystemId": "test-external-id",
  "requestedBy": "e2e-eval-XX",
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateOrder": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500 },
    "SubmitOrder": { "simDelay": 500, "failOnAttempts": [1, 2, 3] }
  }
}
EOF
)

# Initiate job
IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1

# Poll for completion
poll_job "$JOB_ID" 60 2 || exit 1
```

---

### Pattern: Test Retry Exhaustion

```bash
# Create job that will exhaust retries
PAYLOAD=$(cat <<EOF
{
  "customerId": 1,
  "orderId": 1,
  "testOptions": {
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}
EOF
)

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1

# Wait for failure (not completion)
ATTEMPTS=0
MAX_ATTEMPTS=30

while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
  STATUS=$(get_job_status "$JOB_ID" | jq -r '.status')

  if [ "$STATUS" = "failed" ]; then
    echo "Job failed as expected"
    break
  fi

  sleep 2
  ATTEMPTS=$((ATTEMPTS + 1))
done
```

---

### Pattern: Test Partial Success

```bash
# One step fails, one succeeds
PAYLOAD=$(cat <<EOF
{
  "customerId": 1,
  "orderId": 1,
  "testOptions": {
    "SubmitCustomer": { "failOnAttempts": [1, 2, 3] }
  }
}
EOF
)

IFS=':' read -r JOB_ID CORRELATION_ID <<< "$(initiate_job "$PAYLOAD")" || exit 1

# Wait for completion
poll_job "$JOB_ID" 60 2 || exit 1

# Validate step statuses
STEPS=$(get_job_status "$JOB_ID" | jq -r '.steps[] | "\(.stepNumber)=\(.status)"')

# Expected:
# ValidateCustomer=completed
# ValidateOrder=completed
# SubmitCustomer=failed
# SubmitOrder=completed
```

---

## Best Practices

### 1. Use Pattern 1 for Most Tests

```json
// Good: Simple and fast
{
  "testOptions": {
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}

// Avoid: Unnecessary delay slows down tests
{
  "testOptions": {
    "SubmitOrder": { "failureAfter": 100, "failOnAttempts": [1, 2, 3] }
  }
}
```

**Reason:** Pattern 1 is simpler, faster, and just as effective for most scenarios.

---

### 2. Keep Delays Short

```json
// Good: Fast enough to test, quick enough for CI
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "SubmitOrder": { "simDelay": 500 }
  }
}

// Avoid: Unnecessarily slow tests
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 5000 },
    "SubmitOrder": { "simDelay": 5000 }
  }
}
```

**Reason:** Fast tests = faster feedback = faster development.

---

### 3. Document Test Intent

```bash
PAYLOAD=$(cat <<EOF
{
  "customerId": 1,
  "orderId": 1,
  "testOptions": {
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  },
  "comment": "Test exhausts retries -> DLQ -> job marked as failed"
}
EOF
)
```

**Reason:** Comments explain test intent to future developers.

---

### 4. Validate Environment

```bash
# Check if simulations are enabled
if [ "$ENABLE_REQUESTS_FOR_SIMULATED_DELAYS" != "true" ]; then
  echo "Warning: Simulated delays not enabled"
  echo "   Set ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true in worker environment"
fi
```

**Reason:** Catch configuration issues early.

---

### 5. Test One Thing At A Time

```json
// Good: Test one failure scenario
{
  "testOptions": {
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}

// Avoid: Multiple failures complicate debugging
{
  "testOptions": {
    "ValidateCustomer": { "failOnAttempts": [1] },
    "SubmitCustomer": { "failOnAttempts": [2] },
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}
```

**Reason:** Simple tests are easier to understand and debug.

---

## Reference Tables

### Quick Reference: Delay Options (Order-Processing)

```json
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 500 },
    "ValidateOrder": { "simDelay": 500 },
    "SubmitCustomer": { "simDelay": 500 },
    "SubmitOrder": { "simDelay": 500 }
  }
}
```

---

### Quick Reference: Failure Options (Order-Processing)

```json
{
  "testOptions": {
    // Pattern 1: Immediate failure on specific attempts
    "ValidateCustomer": { "failOnAttempts": [1, 2, 3] },
    "ValidateOrder": { "failOnAttempts": [1, 2, 3] },
    "SubmitCustomer": { "failOnAttempts": [1, 2, 3] },
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] },

    // Pattern 2/3: Delayed failures (optional)
    "ValidateCustomer": { "failureAfter": 100 },
    "ValidateOrder": { "failureAfter": 100 },
    "SubmitCustomer": { "failureAfter": 100 },
    "SubmitOrder": { "failureAfter": 100 }
  }
}
```

---

### Retry Behavior Reference

| Attempts | SQS Receive Count | What Happens |
|----------|-------------------|--------------|
| 1 | 1 | First attempt |
| 2 | 2 | First retry (after failure) |
| 3 | 3 | Second retry (after failure) |
| DLQ | - | After 3 failures, moved to DLQ |

**SQS Configuration:**
- `maxReceiveCount: 3` - Maximum delivery attempts
- After exhausting retries, message moves to DLQ
- Maintenance task marks job as failed based on DLQ presence

---

## Common Scenarios

### Scenario 1: Demo a Complete Job

```json
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 2000 },
    "ValidateOrder": { "simDelay": 2000 },
    "SubmitCustomer": { "simDelay": 2000 },
    "SubmitOrder": { "simDelay": 2000 }
  }
}
```

**Use:** Presentations, training, demos

---

### Scenario 2: Test DLQ Routing

```json
{
  "testOptions": {
    "SubmitOrder": { "failOnAttempts": [1, 2, 3] }
  }
}
```

**Use:** Eval 03 (DLQ Permanent Failure)

---

### Scenario 3: Test Partial Acknowledgement Failure

```json
{
  "testOptions": {
    "SubmitCustomer": { "simDelay": 5000 },
    "SubmitOrder": { "simDelay": 300000 }
  }
}
```

**Use:** Eval 11 (Partial Ack Failure) - long delay allows killing dev-ack-simulator mid-job

---

### Scenario 4: Test Retry Recovery

```json
{
  "testOptions": {
    "SubmitCustomer": { "failOnAttempts": [1, 2] }
  }
}
```

**Use:** Verify system recovers after transient failures

---

## Implementation Details

### How It Works

1. **Request:** Client includes `testOptions` in job payload
2. **Orchestrator:** Passes `testOptions` through to workers via `input` field
3. **Workers:** Extract `testOptions` using `getMyTestOptions(message)`
4. **Validation:** Workers check `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` env var
5. **Execution:** If enabled, workers respect delays and failures

### Code Flow

```typescript
// In worker handler
const testOptions = getMyTestOptions(message);
const delay = testOptions?.simDelay;
const failOnAttempts = testOptions?.failOnAttempts;

// Simulate failure first (if configured)
await simulateFailure(
  testOptions?.failureAfter,
  failOnAttempts,
  currentAttempt,
  "Validate Customer"
);

// Then simulate work delay
await simulateWork(delay, "Validate Customer");

// Then execute actual work
await performValidation();
```

---

## Troubleshooting

### Test Options Not Working

**Problem:** Delays/failures not happening

**Solution:**
```bash
# Check environment variable
docker exec <worker-container> printenv | grep ENABLE_REQUESTS_FOR_SIMULATED_DELAYS

# Should output:
# ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true

# If not set, add to docker-compose.workers.yml:
environment:
  - ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
```

---

### Failures Happening When Not Expected

**Problem:** Production jobs failing

**Solution:** Ensure `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` is NOT set in production:

```bash
# Production environment should NOT have this set
# If it exists, remove it immediately
```

---

### Lambda Timeout Errors

**Problem:** Lambda timing out with delays

**Solution:** Keep total delay under 13 seconds:

```json
// Bad: 15 seconds exceeds Lambda timeout
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 15000 }
  }
}

// Good: 10 seconds is safe
{
  "testOptions": {
    "ValidateCustomer": { "simDelay": 10000 }
  }
}
```

---

## Related Documentation

- **[API-IMPROVEMENT-SIMULATE-FAILURE.md](../API-IMPROVEMENT-SIMULATE-FAILURE.md)** - History of API improvements
- **[setpoint-evals/SE-02-dlq-permanent-failure/README.md](../setpoint-evals/SE-02-dlq-permanent-failure/README.md)** - DLQ testing with failures
- **[setpoint-evals/README.md](../setpoint-evals/README.md)** - Core engine SE catalog
- **[workflows/00-template/setpoint-evals/SE-01-happy-path/README.md](../workflows/00-template/setpoint-evals/SE-01-happy-path/README.md)** - Template for new SEs

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 7, 2025 | Initial version |
| 1.1 | Dec 7, 2025 | Added Pattern 1 (immediate failures without delay) |
| 2.0 | Feb 28, 2026 | Updated to DTM naming conventions (domain-appropriate step names) |

---

**Status:** Current
**Maintained By:** DTM Team
**Last Updated:** February 28, 2026

