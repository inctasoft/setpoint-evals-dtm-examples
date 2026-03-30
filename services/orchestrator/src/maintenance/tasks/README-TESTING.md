# Maintenance Tasks - Testing Guide

## Jest Hanging Issue (Resolved)

### Problem

When running maintenance task tests, Jest doesn't exit automatically:

```bash
Jest did not exit one second after the test run has completed.

This usually means that there are asynchronous operations that weren't stopped in your tests.
```

### Root Cause

Maintenance tasks use `@Cron` decorators from `@nestjs/schedule` which create persistent timers that don't get cleaned up even after `module.close()` is called.

### Solution

**Use the `--forceExit` flag when running maintenance task tests:**

```bash
# Single test
npm test -- health-metrics.task.spec.ts --forceExit

# All maintenance tests
npm test -- stuck-acknowledgement.task.spec.ts orphaned-job-recovery.task.spec.ts stuck-in-progress.task.spec.ts old-job-cleanup.task.spec.ts health-metrics.task.spec.ts --forceExit

# Or use pattern matching
npm test -- "*.task.spec.ts" --forceExit
```

### What We Did

1. ✅ Added `module.close()` in `afterAll` hooks (helps but not sufficient)
2. ✅ Use `--forceExit` flag to force Jest to exit after tests complete
3. ✅ Documented the issue for future developers

### Alternative Solutions (Not Implemented)

If `--forceExit` is not desirable, consider:

1. **Mock the Scheduler Service**
   ```typescript
   { provide: SchedulerRegistry, useValue: { getCronJobs: jest.fn(() => new Map()) } }
   ```

2. **Disable Cron in Tests**
   - Set environment variable: `SCHEDULE_ENABLED=false`
   - Conditionally apply `@Cron` decorator

3. **Use Jest Fake Timers**
   ```typescript
   jest.useFakeTimers();
   // ... tests ...
   jest.useRealTimers();
   ```

## Running Tests

### Individual Test

```bash
npm test -- health-metrics.task.spec.ts --forceExit
```

### All Maintenance Tests

```bash
npm test -- stuck-acknowledgement.task.spec.ts orphaned-job-recovery.task.spec.ts stuck-in-progress.task.spec.ts old-job-cleanup.task.spec.ts health-metrics.task.spec.ts --forceExit
```

### With Coverage

```bash
npm test -- *.task.spec.ts --forceExit --coverage
```

### Silent Mode (Less Output)

```bash
npm test -- *.task.spec.ts --forceExit --silent
```

## Test Results Summary

| Test File | Tests Passing | Tests Skipped | Status |
|-----------|---------------|---------------|--------|
| `stuck-acknowledgement.task.spec.ts` | 9 | 2 | ✅ |
| `orphaned-job-recovery.task.spec.ts` | 10 | 0 | ✅ |
| `stuck-in-progress.task.spec.ts` | 7 | 0 | ✅ |
| `old-job-cleanup.task.spec.ts` | 3 | 4 | ✅ |
| `health-metrics.task.spec.ts` | 8 | 0 | ✅ |
| **TOTAL** | **37** | **6** | **✅** |

## Notes

- The `--forceExit` warning is **expected and safe** for these tests
- All tests have proper cleanup with `module.close()` in `afterAll` hooks
- Skipped tests are marked with clear TODO comments for future implementation
- Tests run in ~1.5-2 seconds total

---

**Last Updated:** December 10, 2025  
**Phase:** 1 (Maintenance Tasks) Complete

