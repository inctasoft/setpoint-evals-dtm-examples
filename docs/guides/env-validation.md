# 🔍 Environment Variable Validation Guide

## 📋 Overview

This document defines **required environment variables** for different scenarios (local dev, testing, E2E evals, production) and provides validation tools to prevent common configuration issues.

**Purpose**: Prevent runtime failures due to missing or incorrect environment variables.

---

## 🎯 Quick Start

### Validate Your Environment

```bash
# Validate current .env file
./scripts/validate-env.sh

# Validate specific environment
./scripts/validate-env.sh .env.development

# Verbose output with recommendations
./scripts/validate-env.sh --verbose

# Check specific scenario requirements
./scripts/validate-env.sh --scenario e2e-tests
```

### Common Issues Detected

| Issue                                          | Impact                             | Detection    |
| ---------------------------------------------- | ---------------------------------- | ------------ |
| Missing `ENABLE_DEV_ACK_SIMULATOR`             | Preflight warning (convention)     | ✅ Validated |
| Missing `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` | Delays not applied in workers      | ✅ Validated |
| Wrong Kafka broker URL                         | Kafka connection failures          | ✅ Validated |
| Missing database credentials                   | App startup failure                | ✅ Validated |
| Invalid UUID format                            | API validation errors              | ✅ Validated |

> **Note on `ENABLE_DEV_ACK_SIMULATOR`**: This variable is a **preflight check convention**, not a runtime control. The dev-ack-simulator runs when the Docker Compose `dev-tools` profile is active. If migrations hang at `WAITING_FOR_ACK`, check that the `dev-ack-simulator` container is running (`docker ps | grep dev-ack-simulator`).

---

## 📊 Required Variables by Environment

### 🟢 Local Development (`.env`, `.env.local`)

#### Database Configuration

| Variable                 | Required | Example             | Description              |
| ------------------------ | -------- | ------------------- | ------------------------ |
| `POSTGRES_HOST`          | ✅       | `localhost`         | PostgreSQL host          |
| `POSTGRES_PORT`          | ✅       | `5432`              | PostgreSQL port          |
| `POSTGRES_DB`            | ✅       | `dtm` | Database name            |
| `POSTGRES_USER`          | ✅       | `postgres`          | Database user            |
| `POSTGRES_PASSWORD`      | ✅       | `postgres`          | Database password        |

#### Kafka Configuration

| Variable                  | Required | Example                   | Description       |
| ------------------------- | -------- | ------------------------- | ----------------- |
| `KAFKA_BROKER`            | ✅       | `kafka:9092`              | Kafka broker URL  |
| `KAFKA_CONSUMER_GROUP_ID` | ✅       | `dtm-service-group` | Consumer group ID |

#### LocalStack / AWS Configuration

| Variable                | Required | Example                  | Description           |
| ----------------------- | -------- | ------------------------ | --------------------- |
| `AWS_REGION`            | ✅       | `us-east-1`              | AWS region            |
| `AWS_ENDPOINT`          | ✅       | `http://localstack:4566` | LocalStack endpoint   |
| `AWS_ACCESS_KEY_ID`     | ✅       | `test`                   | LocalStack access key |
| `AWS_SECRET_ACCESS_KEY` | ✅       | `test`                   | LocalStack secret key |

#### Feature Flags (Local Development)

| Variable                                  | Required | Value   | Description                                                 |
| ----------------------------------------- | -------- | ------- | ----------------------------------------------------------- |
| `ENABLE_DEV_ACK_SIMULATOR`                | ⚠️       | `true`  | Preflight convention (actual control: `dev-tools` profile)  |
| `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS`    | ✅       | `true`  | Allow simulated delays in workers                           |
| `ENABLE_MIGRATION_REQUESTS_DEDUPLICATION` | ⚠️       | `false` | Enable/disable deduplication                                |
| `AUTO_MIGRATE_ON_CONSUMER_CREATED`        | ⚠️       | `true`  | Auto-trigger migrations from Kafka                          |
| `AUTO_MIGRATE_ON_CONSUMER_UPDATED`        | ⚠️       | `false` | Auto-trigger on updates                                     |

---

### 🧪 E2E Testing / Evals

**All Local Development variables PLUS:**

| Variable                               | Required | Value         | Notes                                                           |
| -------------------------------------- | -------- | ------------- | --------------------------------------------------------------- |
| `ENABLE_DEV_ACK_SIMULATOR`             | ⚠️       | `true`        | Preflight convention (ensure `dev-ack-simulator` is running)    |
| `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` | ✅       | `true`        | Required for delay/retry/DLQ tests                              |
| `NODE_ENV`                             | ⚠️       | `development` | Optional, enables dev features                                  |

**Eval-Specific Requirements:**

| Eval                         | Additional Requirements                               |
| ---------------------------- | ----------------------------------------------------- |
| **01-happy-path**            | Standard delays working                               |
| **03-dlq-permanent-failure** | SQS DLQ configured, max retries = 3                   |
| **04-custom-ack-payloads**   | `dev-ack-simulator` container running                 |

---

### 🏭 Production (`.env.production.example`)

#### Feature Flags (Production)

| Variable                                  | Required | Value        | Description                                                 |
| ----------------------------------------- | -------- | ------------ | ----------------------------------------------------------- |
| `ENABLE_DEV_ACK_SIMULATOR`                | ⚠️       | `false`      | Convention (ensure `dev-tools` profile is NOT active)       |
| `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS`    | ✅       | `false`      | **CRITICAL**: Must be disabled in production                |
| `ENABLE_MIGRATION_REQUESTS_DEDUPLICATION` | ⚠️       | `true`       | Recommended for production                                  |
| `NODE_ENV`                                | ✅       | `production` | Disables dev features                                       |

#### Production Safety Checklist

- [ ] `dev-tools` Docker profile is NOT active (no `dev-ack-simulator` container)
- [ ] `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false`
- [ ] `NODE_ENV=production`
- [ ] Real Kafka broker URLs (not localhost)
- [ ] Real database credentials (not test/dev)
- [ ] Real AWS endpoints (not LocalStack)

---

## 🛠️ Validation Script Usage

### Basic Validation

```bash
# Validate current environment
./scripts/validate-env.sh

# Output:
# ✅ POSTGRES_HOST: localhost
# ✅ ENABLE_DEV_ACK_SIMULATOR: true
# ❌ KAFKA_BROKER: NOT SET
# ⚠️  ENABLE_REQUESTS_FOR_SIMULATED_DELAYS: false (should be true for local dev)
```

### Scenario-Specific Validation

```bash
# Validate for E2E testing
./scripts/validate-env.sh --scenario e2e-tests

# Validate for production deployment
./scripts/validate-env.sh --scenario production

# Validate for local development
./scripts/validate-env.sh --scenario local-dev
```

### Verbose Mode

```bash
./scripts/validate-env.sh --verbose

# Shows:
# - Current value
# - Expected value
# - Recommendations
# - Related documentation
```

### Exit Codes

| Code | Meaning                               |
| ---- | ------------------------------------- |
| 0    | All required variables valid          |
| 1    | Critical variables missing            |
| 2    | Warning: Non-critical issues detected |

---

## 🚨 Critical Variable Checklist

### Before Running E2E Tests

**MUST BE SET:**

```bash
ENABLE_DEV_ACK_SIMULATOR=true
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
KAFKA_BROKER=kafka:9092
AWS_ENDPOINT=http://localstack:4566
```

**If these are missing:**

- ❌ Migrations will **hang** at `WAITING_FOR_ACK` status
- ❌ Simulated delays won't be applied
- ❌ Tests will timeout and fail

### Before Production Deployment

**MUST BE SET:**

```bash
ENABLE_DEV_ACK_SIMULATOR=false
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false
NODE_ENV=production
```

**If these are wrong:**

- ❌ Dev simulator will run in production (performance impact)
- ❌ Simulated delays could be applied (security issue)
- ❌ Development features enabled in production

---

## 🔍 Validation Examples

### Example 1: Valid Local Development

```bash
# .env file contents
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=dtm
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
KAFKA_BROKER=kafka:9092
AWS_ENDPOINT=http://localstack:4566
ENABLE_DEV_ACK_SIMULATOR=true
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
```

**Validation Result:**

```
✅ All required variables present
✅ Feature flags correctly set for local development
✅ Ready to run E2E tests
```

---

### Example 2: Missing Critical Variable

```bash
# .env file contents (MISSING ENABLE_DEV_ACK_SIMULATOR)
POSTGRES_HOST=localhost
KAFKA_BROKER=kafka:9092
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true
```

**Validation Result:**

```
❌ CRITICAL: ENABLE_DEV_ACK_SIMULATOR is not set
   Impact: Migrations will hang at WAITING_FOR_ACK status
   Fix: Add ENABLE_DEV_ACK_SIMULATOR=true to .env file

⚠️  WARNING: Several database variables missing
   Impact: Application may fail to start
   Fix: See ENV-VALIDATION.md for required database variables
```

---

### Example 3: Production Safety Check

```bash
# .env.production file
NODE_ENV=production
ENABLE_DEV_ACK_SIMULATOR=true  # ❌ WRONG!
ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=false
```

**Validation Result:**

```
❌ PRODUCTION SAFETY VIOLATION: ENABLE_DEV_ACK_SIMULATOR=true
   This is a DEVELOPMENT ONLY feature!
   Impact: Dev acknowledgement simulator will run in production
   Fix: Set ENABLE_DEV_ACK_SIMULATOR=false
   Documentation: See docs/FEATURES.md for production safety guidelines
```

---

## 📚 Variable Categories

### Core Infrastructure

- Database connections (PostgreSQL core DB and per-workflow source DBs)
- Message brokers (Kafka)
- Cloud services (AWS/LocalStack)

### Feature Flags

- Development features (simulators, delays)
- Business features (deduplication, auto-job)
- Security features (authentication, encryption)

### Application Behavior

- Environment mode (development, test, production)
- Logging levels
- Performance tuning

---

## 🐛 Troubleshooting

### Issue: Job Hangs at WAITING_FOR_ACK

**Symptom:**

- Job status: `processing`
- Transform step status: `waiting_for_ack`
- No acknowledgement received after 5+ minutes

**Root Cause:**
`ENABLE_DEV_ACK_SIMULATOR` is not set to `true`

**Fix:**

```bash
# Add to .env file
echo "ENABLE_DEV_ACK_SIMULATOR=true" >> .env

# Restart orchestrator
docker compose restart orchestrator

# Verify in logs
docker logs dtm-orchestrator | grep "DevAckSimulatorService"
# Should see: "✅ Dev Acknowledgement Simulator is ENABLED"
```

**Verification:**

```bash
# Check orchestrator logs
./scripts/local-env.sh logs orchestrator | grep -i "ack"

# Expected output:
# [DevAckSimulatorService] ✅ Dev Acknowledgement Simulator is ENABLED
# [KafkaConsumerService] ✅ Registered handler for topic: dtm.step.ack
# [KafkaConsumerService] ✅ Registered handler for topic: dtm.step.ack
```

---

### Issue: Simulated Delays Not Applied

**Symptom:**

- Job completes too fast
- Expected 30s, completed in 3s
- Delays specified in `testOptions` payload

**Root Cause:**
`ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` is not set to `true`

**Fix:**

```bash
# Add to .env file
echo "ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true" >> .env

# Redeploy Lambda workers (they need the env var)
./scripts/local-env.sh deploy workers

# Restart orchestrator
docker compose restart orchestrator
```

**Security Note:**
This flag MUST be checked in Lambda worker code before applying delays. See `tools/*/src/index.ts`.

---

### Issue: E2E Eval Fails at Startup

**Symptom:**

```
❌ EVAL FAILED: Environment validation failed
Required variables missing: ENABLE_DEV_ACK_SIMULATOR, KAFKA_BROKER
```

**Root Cause:**
Environment not properly configured for E2E testing

**Fix:**

```bash
# Run validation script
./scripts/validate-env.sh --scenario e2e-tests

# Fix reported issues
# Then re-run eval
./setpoint-evals/01-retry-transient-failure/test.sh
```

---

## 🧪 Testing Validation

### Unit Test the Validator

```bash
# Run validator tests
pnpm test scripts/validate-env.spec.ts

# Test with missing variables
ENABLE_DEV_ACK_SIMULATOR= ./scripts/validate-env.sh
# Should exit with code 1 and clear error message

# Test with wrong values
ENABLE_DEV_ACK_SIMULATOR=false ./scripts/validate-env.sh --scenario e2e-tests
# Should warn that value should be 'true' for E2E tests
```

---

## 📖 Related Documentation

- [FEATURES.md](../FEATURES.md) - Feature flag documentation
- [CUSTOM-ACK-PAYLOADS.md](custom-ack-payloads.md) - Acknowledgement simulator details
- [SQS-POLLER-FIXES.md](../../CHANGELOG/SQS-POLLER-FIXES.md) - SQS configuration and retry behavior
- [setpoint-evals/README.md](../../setpoint-evals/README.md) - SE testing guide
- [.cursorrules](.cursorrules) - Environment validation rules

---

## 🎓 Best Practices

### For Developers

1. **Run validation before every E2E test**

   ```bash
   ./scripts/validate-env.sh && ./setpoint-evals/01-retry-transient-failure/test.sh
   ```

2. **Keep `.env.*.example` files updated**
   - Add new variables to ALL example files
   - Document purpose and expected values
   - Include in validation script

3. **Document new feature flags**
   - Add to this file (ENV-VALIDATION.md)
   - Add to docs/FEATURES.md
   - Add to validation script
   - Update .cursorrules

### For CI/CD

1. **Validate in CI pipeline**

   ```yaml
   - name: Validate Environment
     run: ./scripts/validate-env.sh --scenario production
   ```

2. **Fail fast on validation errors**
   - Don't proceed with deployment if validation fails
   - Log validation errors to CI output
   - Alert team on production safety violations

### For Operations

1. **Pre-deployment checklist**
   - Run production validation script
   - Review feature flag settings
   - Verify no dev features enabled

2. **Monitoring**
   - Alert if `ENABLE_DEV_ACK_SIMULATOR=true` in production
   - Alert if `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true` in production
   - Monitor for environment variable changes

---

## 🔄 Maintenance

### When Adding New Environment Variables

1. **Update this document**
   - Add to appropriate environment section
   - Document purpose, type, example
   - Add validation rules

2. **Update validation script**

   ```bash
   # Add to scripts/validate-env.sh
   validate_required "NEW_VARIABLE" "expected_value" "Error message"
   ```

3. **Update example files**
   - `.env.example`
   - `.env.development.example`
   - `.env.test.example`
   - `.env.production.example`

4. **Update related docs**
   - README.md
   - docs/FEATURES.md
   - Service-specific READMEs

5. **Test validation**

   ```bash
   # Test missing variable
   unset NEW_VARIABLE
   ./scripts/validate-env.sh
   # Should report error

   # Test with variable
   export NEW_VARIABLE=value
   ./scripts/validate-env.sh
   # Should pass
   ```

---

## 📊 Validation Script Features

### Current Capabilities

✅ Validates presence of required variables  
✅ Validates variable types (boolean, number, URL, UUID)  
✅ Scenario-specific validation (local, test, production)  
✅ Production safety checks  
✅ Verbose output with recommendations  
✅ Exit codes for CI/CD integration  
✅ Color-coded output for readability

### Future Enhancements

- [ ] Auto-fix mode (prompt to add missing variables)
- [ ] JSON output for programmatic parsing
- [ ] Integration with E2E eval runner
- [ ] Validation report generation
- [ ] Historical tracking of validation failures

---

## ✅ Quick Reference

### Most Common Issues

| Issue                     | Check                                  | Fix                                              |
| ------------------------- | -------------------------------------- | ------------------------------------------------ |
| Migrations hang           | `ENABLE_DEV_ACK_SIMULATOR`             | Set to `true` in `.env`                          |
| Delays not working        | `ENABLE_REQUESTS_FOR_SIMULATED_DELAYS` | Set to `true` in `.env` and redeploy workers     |
| Kafka connection fails    | `KAFKA_BROKER`                         | Set to `kafka:9092` for local                    |
| Database connection fails | `POSTGRES_*` variables                 | Verify all database variables                    |
| E2E tests fail            | Run validation script                  | `./scripts/validate-env.sh --scenario e2e-tests` |

### Quick Commands

```bash
# Validate environment
./scripts/validate-env.sh

# Fix missing ENABLE_DEV_ACK_SIMULATOR
echo "ENABLE_DEV_ACK_SIMULATOR=true" >> .env && docker compose restart orchestrator

# Fix missing ENABLE_REQUESTS_FOR_SIMULATED_DELAYS
echo "ENABLE_REQUESTS_FOR_SIMULATED_DELAYS=true" >> .env && ./scripts/local-env.sh deploy workers

# Verify DevAckSimulator is running
docker logs dtm-orchestrator | grep "Dev Acknowledgement Simulator"
```

---

**Last Updated**: 2025-11-21  
**Maintainer**: DTM Team
**Version**: 1.0
