# Quick Start: Testing Different API Versions

## 🚀 TL;DR - Copy & Paste Examples

### Test Default (API v1, localhost)
```bash
./scripts/test-health.sh
./scripts/test-new-api.sh
```

### Test API v2 (When Available)
```bash
API_VERSION=v2 ./scripts/test-health.sh
API_VERSION=v2 ./scripts/test-new-api.sh
```

### Test Staging Environment
```bash
ORCHESTRATOR_HOST=https://staging.example.com ./scripts/test-health.sh
```

### Test Staging with v2
```bash
ORCHESTRATOR_HOST=https://staging.example.com API_VERSION=v2 ./scripts/test-health.sh
```

### Set Once, Use Many Times
```bash
export API_VERSION=v2
export ORCHESTRATOR_HOST=https://qa.example.com

# Now all scripts use v2 on QA
./scripts/test-health.sh
./scripts/test-new-api.sh
./scripts/monitor-jobs-api.sh
./ste/01-retry-transient-failure/test.sh
```

## 📋 All Available Variables

| Variable | Default | What It Does |
|----------|---------|--------------|
| `API_VERSION` | `v1` | Sets API version (v1, v2, v3, etc.) |
| `ORCHESTRATOR_HOST` | `http://localhost:3000` | Sets base host URL |
| `ORCHESTRATOR_PORT` | `3000` | Sets port (if host not specified) |
| `API_BASE_URL` | *auto* | Override full API URL if needed |

## 🎯 Common Use Cases

### Local Development
```bash
# Default - just works
./scripts/test-health.sh

# Custom port
ORCHESTRATOR_PORT=4000 ./scripts/test-health.sh
```

### Pre-release Testing
```bash
# Test new API version before release
API_VERSION=v2 ./scripts/test-new-api.sh
```

### Environment Testing
```bash
# Dev environment
ORCHESTRATOR_HOST=https://dev.api.example.com ./scripts/test-health.sh

# QA environment
ORCHESTRATOR_HOST=https://qa.api.example.com ./scripts/test-health.sh

# Staging
ORCHESTRATOR_HOST=https://staging.api.example.com ./scripts/test-health.sh
```

### CI/CD Integration
```bash
# In your pipeline (GitHub Actions, Jenkins, etc.)
export ORCHESTRATOR_HOST=${CI_API_ENDPOINT}
export API_VERSION=${CI_API_VERSION}

./scripts/test-health.sh
./ste/run-all.sh
```

### Kubernetes Port Forward
```bash
# Port forward first
kubectl port-forward svc/orchestrator 8080:3000

# Test against forwarded port
ORCHESTRATOR_HOST=http://localhost:8080 ./scripts/test-health.sh
```

## 📖 Full Documentation

For complete details, see: [`API-VERSION-CONFIGURATION.md`](./API-VERSION-CONFIGURATION.md)

