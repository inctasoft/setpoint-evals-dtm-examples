---
name: monitor
description: Start the DTM Monitor dashboard or CLI monitoring tools.
---

Start DTM monitoring.

Arguments: $ARGUMENTS

Options:
- `dashboard` — Start the web-based Monitor dashboard (port 5173)
- `api` — Start CLI-based API job monitoring
- `sqs` — Start CLI-based SQS queue monitoring

Commands:
- Dashboard:  `./scripts/local-env.sh monitor dashboard`
- API monitor:  `./scripts/local-env.sh monitor api`
- SQS monitor:  `./scripts/local-env.sh monitor sqs`

If no argument is given, start the web dashboard.

The dashboard shows real-time job execution, step progress, SQS queue depths,
and an event log. Requires the orchestrator to be running.
See: docs/guides/monitor-dashboard.md
