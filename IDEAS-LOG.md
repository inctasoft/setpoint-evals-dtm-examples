# Ideas Log — state-transition-evals-dtm-examples

Feature ideas, improvements, wishes. Format: Priority (H/M/L), Effort estimate.

---

### plan-execution workflow — voice-assistant chunk pipeline integration — MOSTLY DONE
**Priority:** High (remaining: STEs)
**Effort:** ~2h remaining (STEs only)
**Plan:** `server-config/plans/dtm-chunk-integration.md`
**Status (2026-03-31):** Phases 0-4 complete. Workflow registered, voice-assistant worker polling SQS, events relay connected, HTTP ACK endpoint added. Key DTM engine changes:
- `WorkflowDefinition.dynamicSteps` flag + `getStepDefinitionsForJob()` for per-job step DAGs
- Per-step input via `stepDef.metadata.stepInput` (dynamic workflows only)
- `orchestration.service.ts` uses dynamic step definitions in `startJob()`, `continueJob()`, `findReadySteps()`, `markDependentStepsAsSkipped()`
- `callback.service.ts` supports cascade-free `WAITING_FOR_ACK` for dynamic workflows (no Kafka topic needed)
- New `POST /api/v1/callback/acknowledge` HTTP endpoint for approve/reject
**Remaining:** Write 5 STEs at `workflows/plan-execution/ste/`

### Monitor UI — embeddable component extraction
**Priority:** Medium
**Effort:** ~4h
Extract the monitor dashboard components (`JobList`, `JobDetail`, `StepRow`, `EventLog`, `ProgressBar`) into a reusable package that can be embedded in other Preact apps (e.g., voice-assistant). Currently a standalone Vite app (`apps/monitor/`). The WebSocket hook (`useWebSocket`) is already cleanly separated.
