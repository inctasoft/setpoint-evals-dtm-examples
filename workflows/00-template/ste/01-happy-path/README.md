# STE 01: Happy Path

## What This Tests

The basic end-to-end workflow execution with no errors, and no simulated delays or failures.

## Expected Outcome

- Job completes with status `COMPLETED`
- All steps transition through: PENDING → DELEGATED → IN_PROGRESS → COMPLETED
- Steps requiring ACK: COMPLETED → WAITING_FOR_ACK → COMPLETED (after ACK)
- No errors in any step

## Prerequisites

- All services running (`./scripts/local-env.sh start --workflow my-workflow`)
- Workers deployed (`./scripts/local-env.sh deploy-workers --workflow my-workflow`)
- Source database seeded with test data

## Run

```bash
./test.sh
```
