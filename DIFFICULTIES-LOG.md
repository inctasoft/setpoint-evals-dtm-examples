# Open Issues & Questions

> Live issue tracker. Only UNRESOLVED items belong here.
> Resolved items are deleted — git history serves as the changelog.

---

## 1. Orchestrator Unit Tests — 4 Suites / 22 Tests Failing

**Severity: MEDIUM (test quality)**

4 test suites have behavioral assertion failures. The DI/mock issues were fixed (2026-03-01), but the test expectations still reflect pre-engine-generalization behavior.

**Failing suites:**
- `acknowledgement.handler.spec.ts` — expects old `repo.save` pattern for ACK metadata
- `orchestration.service.spec.ts` — test flow expectations don't match post-generalization orchestration
- `delegation.service.spec.ts` — behavioral assertions need updating for `claimForDelegation` flow
- `callback.service.spec.ts` — multiple assertions don't match post-generalization behavior

**To fix:** Update test assertions to match current service behavior — not a DI problem, purely test data and expectations.

```bash
# To verify current state:
pnpm test  # 17 PASS, 4 FAIL, 251/301 tests passing
```

---

## Summary

| Issue | Severity | Status |
|-------|----------|--------|
| Orchestrator unit test failures (4 suites) | MEDIUM | OPEN — need behavioral assertion updates |

### system-architecture.md describes steps that do not exist (stale ETL-era section)
**Severity:** Low
**Status:** Fixed (2026-07-15)
`docs/guides/system-architecture.md` Section 7.1 ("Extended Multi-Cascade Example", including "Data Flow Between Steps" / "How Dependency Outputs Are Injected") used a 'SubmitBenefits' example depending on 'SubmitProduct'/'SubmitCustomer' with targetCustomerId/targetProductId fields and Extract/Transform ETL terminology — none of which exist in the real order-processing workflow.config.ts (Product is validate-only, no submit step). Rewrote the section against the real `default`-variant DAG (all 13 steps, fan-out LineItem cascade, parallel Payment/Shipment, fan-in ArchiveProcessedOrder) with real code references (`submit-order.ts`, `archive-processed-order.ts`, `collectDependencyOutputs()`, `LambdaStepPayload`). Also swept and fixed the same class of drift in Sections 3, 5, 6, 6.1, and 7 (nonexistent `sqsQueueName`/`lambdaFunctionName`/`ORDER_PROCESSING_STEPS` fields and export, `SubmitProduct` references, `forename`/`surname` field names, wrong Kafka topic names, stale FK-injection examples, duplicate `ValidateOrder`/`SubmitOrder` mermaid node labels, stale "6 steps" counts). See PR against `fix/system-architecture-real-dag`.
