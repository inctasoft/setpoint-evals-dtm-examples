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
