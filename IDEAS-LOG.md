# Ideas Log — setpoint-evals-for-agentic-engineering-example

Feature ideas, improvements, wishes. Format: Priority (H/M/L), Effort estimate.

---

### plan-execution workflow — voice-assistant chunk pipeline integration — MOSTLY DONE
**Priority:** High (remaining: SEs)
**Effort:** ~2h remaining (SEs only)
**Plan:** `server-config/plans/dtm-chunk-integration.md`
**Status (2026-03-31):** Phases 0-4 complete. Workflow registered, voice-assistant worker polling SQS, events relay connected, HTTP ACK endpoint added. Key DTM engine changes:
- `WorkflowDefinition.dynamicSteps` flag + `getStepDefinitionsForJob()` for per-job step DAGs
- Per-step input via `stepDef.metadata.stepInput` (dynamic workflows only)
- `orchestration.service.ts` uses dynamic step definitions in `startJob()`, `continueJob()`, `findReadySteps()`, `markDependentStepsAsSkipped()`
- `callback.service.ts` supports cascade-free `WAITING_FOR_ACK` for dynamic workflows (no Kafka topic needed)
- New `POST /api/v1/callback/acknowledge` HTTP endpoint for approve/reject
**Remaining:** Write 5 SEs at `workflows/plan-execution/setpoint-evals/`

### Monitor UI — embeddable component extraction
**Priority:** Medium
**Effort:** ~4h
Extract the monitor dashboard components (`JobList`, `JobDetail`, `StepRow`, `EventLog`, `ProgressBar`) into a reusable package that can be embedded in other Preact apps (e.g., voice-assistant). Currently a standalone Vite app (`apps/monitor/`). The WebSocket hook (`useWebSocket`) is already cleanly separated.

### Decide the single source-db story (dedicated containers vs dtm-db copies)
Found during story-seeds (2026-07-16): Lambda workers read source data from copies INSIDE dtm-db (loaded by scripts/docker/init-all-databases.sh), not from the three dedicated source-db containers (ports 5449-5451) the README/CLAUDE.md advertise. The seed duplication was collapsed (canonical files now mounted into dtm-db), but the architecture still ships TWO database sets where workers use one. For the showcase narrative (and the Phase-6 C4 doc): either point deploy-workers' <WORKFLOW>_DB_HOST at the dedicated containers and drop the dtm-db copies, or drop the dedicated containers and document dtm-db as the single source host. Two copies = permanent drift risk the SE-06 meta-SEs currently paper over by targeting the worker-facing copy.
