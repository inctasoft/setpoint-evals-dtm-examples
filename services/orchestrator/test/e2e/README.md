# E2E Tests - Direct Database Verification

This directory contains **Jest-based E2E tests** that directly query the database to verify job outcomes. These tests complement the bash-based STE system.

## Why Both Jest E2E and Bash Evals?

### Speed vs Coverage Trade-off

| Aspect | Jest E2E Tests (this dir) | Bash Evals (`/e2e-evals/`) |
|--------|---------------------------|----------------------------|
| **Framework** | Jest + TypeScript | Bash scripts |
| **DB Access** | Direct SQL queries | HTTP API + jq parsing |
| **Speed** | **FAST** (~500ms-15s) | Slower (30s-3min) |
| **Delays** | All delays = 0 | Realistic delays |
| **Use Case** | Happy path verification | Full scenario coverage |
| **Assertions** | Jest `expect()` | Bash conditionals |

### When to Use Each

**Use Jest E2E tests when:**
- ✅ Quick feedback during development
- ✅ CI/CD pipeline pre-merge checks
- ✅ Verifying database state directly
- ✅ Testing happy paths without timing concerns

**Use Bash Evals when:**
- ✅ Testing failure scenarios (DLQ, retries)
- ✅ Testing concurrent jobs
- ✅ Validating SQS/Kafka behavior
- ✅ Production-like timing verification
- ✅ Full E2E validation before release

## Available Tests

### 1. `payment-history-happy-path.e2e-spec.ts`
Tests the complete order-processing workflow:
- Customer -> Order -> LineItems (fan-out)
- Verifies database records directly
- No simulated delays

### 3. Infrastructure Tests (existing)
- `health.e2e-spec.ts` - Health endpoint verification
- `kafka-consumer.e2e-spec.ts` - Kafka consumer functionality
- `kafka-publish.e2e-spec.ts` - Kafka producer functionality

## Running the Tests

### Prerequisites

1. **Start all services:**
   ```bash
   cd sms/
   ./scripts/local-env.sh up
   ```

2. **Wait for services to be ready:**
   ```bash
   ./scripts/local-env.sh status
   ```

### Run Workflow E2E Tests

```bash
cd services/orchestrator

# Run all workflow happy path tests (fast)
npm run test:e2e:workflow

# Run specific test file
npm run test:e2e -- --testPathPattern=payment-history-happy-path

# Run with verbose output
npm run test:e2e:workflow -- --verbose
```

### Run All E2E Tests

```bash
npm run test:e2e
```

## Test Data

| Customer | Order | Has LineItems | Has Payments |
|----------|-------|---------------|--------------|
| CUST-1001 | ORD-1001 | Yes | No |
| CUST-1014 | ORD-1014 | No | No |
| CUST-1027 | ORD-1027 | No | Yes (3 records) |

## Environment Variables

```bash
# Database connections (defaults to localhost)
DATABASE_HOST=localhost
DATABASE_PORT=5433
DATABASE_USER=dtm_user
DATABASE_PASSWORD=dtm_pass
DATABASE_NAME=dtm

# Orchestrator URL (default: http://localhost:3000)
ORCHESTRATOR_URL=http://localhost:3000
```

## Key Features

### No Delays
Unlike the bash evals which use `testOptions` to simulate realistic delays, these Jest tests explicitly set all delays to `0` for fast execution:

```typescript
testOptions: {
  ValidateCustomer: { simDelay: 0 },
  SubmitCustomer: { simDelay: 0 },
  ValidateOrder: { simDelay: 0 },
  SubmitOrder: { simDelay: 0 },
  // ... all delays set to 0
}
```

### Direct DB Verification
Tests query the database directly to verify:
- Job status changes
- Step completion with output data
- Submitted data structure

```typescript
// Example: Verify step completed with output
const step = await db.getStep(jobId, 'SubmitCustomer');
expect(step.status).toBe('completed');
expect(step.output).toHaveProperty('submittedCustomer');
```

### Fast Feedback
Typical execution times:
- Single entity test: ~5-10 seconds
- Full 3-entity flow: ~15-30 seconds

## Comparison with Bash Evals

Use **Jest E2E tests** when you need:
- Fast verification of happy paths
- Direct database inspection
- TypeScript type safety
- IDE integration (debugging, code navigation)

Use **Bash STEs** when you need:
- Failure scenario testing (DLQ, retries)
- Timing/delay verification
- Concurrent job testing
- Full production-like scenarios

