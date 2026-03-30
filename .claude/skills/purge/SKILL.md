---
name: purge
description: Purge DTM database, SQS queues, and Kafka data.
---

Purge DTM data (keeps services running).

Arguments: $ARGUMENTS

Options:
- (no args) — Purge database only (deletes all jobs and steps)
- `--full` — Purge database + SQS queues + Kafka consumer offsets

Command: `cd sms && ./scripts/local-env.sh purge $ARGUMENTS`

IMPORTANT: This deletes data permanently. Confirm with the user before running.
