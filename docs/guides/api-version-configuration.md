# API Version Configuration for Testing Scripts

## 📋 Overview

All bash testing scripts now use a **centralized API configuration system** that makes it easy to test against different API versions (v1, v2, etc.) and different environments (localhost, staging, production).

## 🎯 Key Features

- ✅ **Single Source of Truth** - All API configuration in one place
- ✅ **Environment Variable Control** - Override settings without editing scripts
- ✅ **API Version Flexibility** - Easily test v1, v2, or future versions
- ✅ **Environment Agnostic** - Test against localhost, staging, or production
- ✅ **Backward Compatible** - Existing scripts still work with defaults

## 📁 Configuration Files

### 1. Central API Configuration

**Location:** `scripts/inc/api-config.sh`

This file defines:

- `ORCHESTRATOR_HOST` - Base host URL (default: `http://localhost:3000`)
- `API_VERSION` - API version to test (default: `v1`)
- `API_BASE_URL` - Full API base URL (constructed: `${ORCHESTRATOR_HOST}/api/${API_VERSION}`)
- Helper functions for building API URLs

### 2. Common Utilities

**Location:** `scripts/inc/common.sh`

Automatically sources `api-config.sh` and provides common functions for all scripts.

### 3. E2E Test Helpers

**Location:** `ste/shared/helpers.sh`

Updated to align with the same configuration pattern for consistency.

## 🚀 Usage Examples

### Default Behavior (API v1, localhost)

```bash
# Just run any script normally - uses defaults
./scripts/test-health.sh
./scripts/test-new-api.sh
./scripts/monitor-jobs-api.sh
```

### Test Against API v2 (Future)

```bash
# Set API_VERSION environment variable
API_VERSION=v2 ./scripts/test-health.sh
API_VERSION=v2 ./scripts/test-new-api.sh

# Or export it for all subsequent commands
export API_VERSION=v2
./scripts/test-health.sh
./scripts/monitor-jobs-api.sh
./scripts/test-new-api.sh
```

### Test Against Staging Environment

```bash
# Point to staging server
ORCHESTRATOR_HOST=https://staging.migration.example.com ./scripts/test-health.sh

# Test staging with v2 API
ORCHESTRATOR_HOST=https://staging.migration.example.com API_VERSION=v2 ./scripts/test-new-api.sh
```

### Test Against Custom Environment

```bash
# Test against a specific environment
export ORCHESTRATOR_HOST=https://qa.migration.example.com
export API_VERSION=v1
./scripts/test-health.sh
./scripts/monitor-jobs-api.sh
```

### Test Against Different Port

```bash
# Change port only (keeps localhost)
ORCHESTRATOR_PORT=4000 ./scripts/test-health.sh

# Or specify full host with custom port
ORCHESTRATOR_HOST=http://localhost:4000 ./scripts/test-health.sh
```

## 📊 Configuration Variables

| Variable            | Default                 | Description                  | Example                        |
| ------------------- | ----------------------- | ---------------------------- | ------------------------------ |
| `ORCHESTRATOR_HOST` | `http://localhost:3000` | Base URL of the orchestrator | `https://api.example.com`      |
| `ORCHESTRATOR_PORT` | `3000`                  | Port (used if HOST not set)  | `4000`                         |
| `API_VERSION`       | `v1`                    | API version to test          | `v2`, `v3`                     |
| `API_BASE_URL`      | _computed_              | Full API URL                 | `http://localhost:3000/api/v1` |

## 🔧 Updated Scripts

The following scripts have been updated to use the new configuration system:

### Core Testing Scripts

- ✅ `scripts/test-health.sh` - Health check endpoint testing
- ✅ `scripts/test-new-api.sh` - Event-based API testing
- ✅ `scripts/test-poc-endpoints.sh` - Legacy POC endpoint testing
- ✅ `scripts/test-kafka-submission.sh` - Kafka integration testing

### Monitoring Scripts

- ✅ `scripts/monitor-jobs-api.sh` - Real-time job monitoring
- ✅ `scripts/monitor-events-api.sh` - Real-time event monitoring

### E2E Test Framework

- ✅ `ste/shared/helpers.sh` - Shared E2E test utilities

### Configuration Files

- ✅ `scripts/inc/api-config.sh` - **NEW** Central API configuration
- ✅ `scripts/inc/common.sh` - Updated to source API config

## 📝 Scripts That May Need Updates

Some scripts may still have hardcoded URLs. If you encounter one, update it using this pattern:

### Before (Hardcoded)

```bash
#!/bin/bash
set -e

ORCHESTRATOR_URL="http://localhost:3000"

curl "$ORCHESTRATOR_URL/api/v1/jobs"
```

### After (Configurable)

```bash
#!/bin/bash
set -e

# Load API configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${SCRIPT_DIR}/inc/api-config.sh"

# Use API_BASE_URL variable
curl "$API_BASE_URL/jobs"
```

## 🎨 Using in Custom Scripts

### Basic Usage

```bash
#!/bin/bash

# Load the API configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${SCRIPT_DIR}/inc/api-config.sh"

# Display current configuration (optional)
display_api_config

# Use the variables
echo "Testing against: $API_BASE_URL"
curl -s "$API_BASE_URL/health" | jq
```

### Using Helper Functions

```bash
#!/bin/bash

# Load configuration
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${SCRIPT_DIR}/inc/api-config.sh"

# Get full URL for a specific endpoint
JOBS_URL=$(get_api_url "jobs")
curl -s "$JOBS_URL" | jq

# Get URL for non-versioned endpoint (if needed)
METRICS_URL=$(get_base_url "metrics")
curl -s "$METRICS_URL"
```

## 🧪 E2E Test Usage

E2E tests now support the same configuration:

```bash
# Run E2E test against v1 (default)
./ste/01-retry-transient-failure/test.sh

# Run E2E test against v2
API_VERSION=v2 ./ste/01-retry-transient-failure/test.sh

# Run against staging
export ORCHESTRATOR_HOST=https://staging.example.com
export API_VERSION=v1
./ste/run-all.sh
```

## 🔍 Debugging

### View Current Configuration

```bash
# Run any script with configuration display
./scripts/test-health.sh
# Will show:
# 📡 API Configuration:
#   Host:        http://localhost:3000
#   Version:     v1
#   Base URL:    http://localhost:3000/api/v1
```

### Validate Configuration

```bash
# Source the config and validate
source ./scripts/inc/api-config.sh
validate_api_config
echo "Host: $ORCHESTRATOR_HOST"
echo "Version: $API_VERSION"
echo "Base URL: $API_BASE_URL"
```

## 📚 Real-World Scenarios

### Scenario 1: Testing API Migration (v1 → v2)

```bash
# Test current production API (v1)
export ORCHESTRATOR_HOST=https://api.production.com
export API_VERSION=v1
./scripts/test-new-api.sh

# Test new API version (v2) on staging
export ORCHESTRATOR_HOST=https://api.staging.com
export API_VERSION=v2
./scripts/test-new-api.sh

# Compare results
```

### Scenario 2: Local Development with Custom Port

```bash
# Developer running orchestrator on port 4000
export ORCHESTRATOR_PORT=4000
./scripts/monitor-jobs-api.sh

# Or
ORCHESTRATOR_HOST=http://localhost:4000 ./scripts/monitor-jobs-api.sh
```

### Scenario 3: Automated Testing in CI/CD

```bash
# In your CI/CD pipeline (e.g., GitHub Actions, Jenkins)
export ORCHESTRATOR_HOST=${CI_API_HOST}
export API_VERSION=${CI_API_VERSION}

# Run all tests
./ste/run-all.sh
./scripts/test-health.sh
./scripts/test-new-api.sh
```

### Scenario 4: Testing Against Kubernetes Service

```bash
# Port-forward first
kubectl port-forward svc/migration-orchestrator 8080:3000

# Test against forwarded port
ORCHESTRATOR_HOST=http://localhost:8080 ./scripts/test-health.sh
```

## 🎯 Benefits

### For Developers

- ✅ No need to edit scripts to test different environments
- ✅ Easy to switch between API versions
- ✅ Consistent behavior across all test scripts
- ✅ Reduced errors from typos in URLs

### For QA/Testing

- ✅ Standardized way to test different environments
- ✅ Easy to run regression tests on multiple API versions
- ✅ Can test staging, QA, and production with same scripts
- ✅ Configuration can be version-controlled separately

### For DevOps/CI

- ✅ Environment-specific testing in pipelines
- ✅ Easy integration with CI/CD variables
- ✅ No script modifications needed for different environments
- ✅ Consistent testing across all stages

## 🐛 Troubleshooting

### Script can't find api-config.sh

**Problem:**

```bash
./scripts/test-health.sh: line 10: api-config.sh: No such file or directory
```

**Solution:**
Make sure the script loads the config with correct path:

```bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "${SCRIPT_DIR}/inc/api-config.sh"
```

### Wrong API version being used

**Problem:** Script uses v1 but you set API_VERSION=v2

**Solution:** Make sure variable is exported:

```bash
export API_VERSION=v2  # Not just: API_VERSION=v2
./scripts/test-health.sh
```

Or pass inline:

```bash
API_VERSION=v2 ./scripts/test-health.sh
```

### Connection refused errors

**Problem:**

```bash
curl: (7) Failed to connect to localhost port 3000: Connection refused
```

**Solution:**

1. Check orchestrator is running: `docker ps | grep orchestrator`
2. Verify the port: `docker ps | grep 3000`
3. Check host/port settings:
   ```bash
   source ./scripts/inc/api-config.sh
   echo $API_BASE_URL
   ```

## 📖 Additional Resources

- **API Documentation:** See `services/orchestrator/src/main.ts` for global prefix configuration
- **Docker Compose:** See `docker-compose.yml` for service port mappings
- **STEs:** See `ste/README.md` for STE testing guide
- **Maintenance API:** See `services/orchestrator/MAINTENANCE.md` for maintenance endpoints

## 🚦 Migration Checklist

If you're updating an old script to use the new configuration:

- [ ] Add API config source at the top of the script
- [ ] Remove hardcoded `ORCHESTRATOR_URL` definition
- [ ] Replace `$ORCHESTRATOR_URL/api/v1/...` with `$API_BASE_URL/...`
- [ ] Replace `http://localhost:3000/api/v1/...` with `$API_BASE_URL/...`
- [ ] Test with default settings
- [ ] Test with custom API_VERSION
- [ ] Test with custom ORCHESTRATOR_HOST
- [ ] Update script documentation if needed

## ✅ Summary

With this new configuration system:

- **Before:** Had to edit scripts to test different API versions/environments
- **After:** Just set environment variables!

```bash
# Simple! Test any version against any environment
API_VERSION=v2 ORCHESTRATOR_HOST=https://staging.com ./scripts/test-health.sh
```

Happy testing! 🎉
