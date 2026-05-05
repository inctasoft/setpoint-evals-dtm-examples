---
scope: Update stale Jest mocks in orchestrator unit tests so 37 of 60 failures pass. Maintenance task DI gets `AdvisoryLockService` mock (5 specs); DelegationService mock gets `getStepDefinitions`; AcknowledgementHandler mock gets `repo.createQueryBuilder` chainable + `cascadePublishService.hasDependentCascades`; WorkflowController duplicate-detection test supplies a payload so dedup branch fires.
risk: Low — only test-side changes, no source modifications. Verifies via `npx jest`.
test: `npx jest --no-coverage --silent` on services/orchestrator → 60 fails → 18 fails (10 → 4 failing suites). 37 fewer assertion failures.
phasing: N/A
---

Partial close on #7 — 70% reduction in test failures. Remaining 18 are heterogeneous behavioral drift (tests expect old service API while code has moved on); see PR body for the deferred portion.
