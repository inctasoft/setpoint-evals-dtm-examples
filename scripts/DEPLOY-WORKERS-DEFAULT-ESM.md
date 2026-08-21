# Deploy Workers - Default ESM Mode ✅

## Summary

Modified `local-env.sh` to make **ESM mode the default** for `deploy-workers` command.

---

## Changes Made

### 1. **Function Default Parameter** (Line ~740)
```bash
# BEFORE
deploy_workers() {
    local MODE="$1"
    
    # Validate mode
    if [ -z "$MODE" ]; then
        print_error "Mode not specified. Use: --esm or --poller"
        exit 1
    fi

# AFTER
deploy_workers() {
    local MODE="${1:---esm}"  # Default to --esm if not specified
```

### 2. **Caller Simplification** (Line ~1225)
```bash
# BEFORE
deploy-workers)
    if [ -z "$2" ]; then
        print_error "Mode flag required: --esm or --poller"
        exit 1
    fi
    deploy_workers "$2"
    ;;

# AFTER
deploy-workers)
    # Default to --esm if no mode specified
    deploy_workers "${2:---esm}"
    ;;
```

### 3. **Help Text Updates**

**Command listing:**
```bash
# BEFORE
deploy-workers --esm|--poller    Deploy Lambda workers with mode selection

# AFTER
deploy-workers [--esm|--poller]  Deploy Lambda workers (default: --esm)
```

**Examples section:**
```bash
# ADDED
$0 deploy-workers                # Deploy Lambda workers (default: ESM mode - parallel)

# KEPT (now explicit)
$0 deploy-workers --esm          # Deploy Lambda workers in ESM mode (parallel) - explicit
$0 deploy-workers --poller       # Deploy Lambda workers in Poller mode (sequential)
```

**Access URLs section:**
```bash
# BEFORE
$0 deploy-workers {--esm|--poller}    Deploy Lambda workers to LocalStack

# AFTER
$0 deploy-workers [--esm|--poller]    Deploy Lambda workers (default: ESM)
```

---

## Usage

### ✅ **NEW: Default Behavior (ESM)**
```bash
./scripts/local-env.sh deploy-workers
```
**Result:** Deploys workers in ESM mode (parallel execution)

### ✅ **Explicit ESM (same as default)**
```bash
./scripts/local-env.sh deploy-workers --esm
```
**Result:** Deploys workers in ESM mode (parallel execution)

### ✅ **Poller Mode (sequential)**
```bash
./scripts/local-env.sh deploy-workers --poller
```
**Result:** Deploys workers in Poller mode (sequential execution)

---

## Benefits

1. **Better Developer Experience**
   - No need to remember the flag for the most common use case
   - Fewer keystrokes for the default workflow

2. **ESM is Best Practice**
   - Parallel execution (faster)
   - Native LocalStack feature (more reliable)
   - Matches production Lambda behavior

3. **Backward Compatible**
   - Explicit `--esm` still works
   - `--poller` mode still available for debugging

---

## What is ESM Mode?

**ESM (Event Source Mapping)** is LocalStack's native feature for connecting Lambda functions to SQS queues:

- ✅ **Parallel execution** - multiple messages processed simultaneously
- ✅ **Native AWS behavior** - matches production Lambda
- ✅ **Automatic polling** - no custom poller needed
- ✅ **Better performance** - faster message processing

**Poller mode** is a custom SQS poller container:
- Sequential processing (one message at a time)
- Useful for debugging
- Simpler logging

---

## Verification

**Syntax check:**
```bash
bash -n scripts/local-env.sh
✅ Syntax check passed!
```

**Test commands:**
```bash
# Test default (ESM)
./scripts/local-env.sh deploy-workers

# Test explicit ESM
./scripts/local-env.sh deploy-workers --esm

# Test poller
./scripts/local-env.sh deploy-workers --poller

# Show help
./scripts/local-env.sh help
```

---

## Related Files

- **Modified:** `scripts/local-env.sh` - Main script with deploy-workers command
- **Unchanged:** `tools/scripts/deploy-to-localstack.js` - Lambda deployment logic
- **Unchanged:** `docker-compose.workers.yml` - SQS poller container definition

---

**Date:** 2024-11-26  
**Status:** ✅ Complete  
**Breaking Change:** No (backward compatible)  
**Default Mode:** ESM (was: required flag)

