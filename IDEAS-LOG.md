# Ideas Log — state-transition-evals-dtm-examples

Feature ideas, improvements, wishes. Format: Priority (H/M/L), Effort estimate.

---

### plan-execution workflow — voice-assistant chunk pipeline integration
**Priority:** High
**Effort:** ~14-18h (shared with voice-assistant)
**Plan:** `server-config/plans/dtm-chunk-integration.md`
Create a `plan-execution` workflow that uses the DTM orchestrator to execute voice-assistant plan chunks. Chunks = steps, plans = jobs. NestJS worker in voice-assistant (not Lambda) consumes SQS, calls Claude SDK (Sonnet), sends HTTP callbacks. HIGH risk chunks use Kafka ACK pattern for human review. This validates DTM as a generic orchestration engine beyond the 3 example workflows. Key adaptations: dynamic step list per job (chunk DAG varies per plan), no source DB (voice-assistant PG is the source), worker is a persistent NestJS service (not Lambda). Also write 5 STEs for the plan-execution workflow.

### Monitor UI — embeddable component extraction
**Priority:** Medium
**Effort:** ~4h
Extract the monitor dashboard components (`JobList`, `JobDetail`, `StepRow`, `EventLog`, `ProgressBar`) into a reusable package that can be embedded in other Preact apps (e.g., voice-assistant). Currently a standalone Vite app (`apps/monitor/`). The WebSocket hook (`useWebSocket`) is already cleanly separated.
