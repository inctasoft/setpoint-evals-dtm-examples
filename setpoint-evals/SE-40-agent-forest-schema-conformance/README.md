# SE-40 — agent-forest schema-conformance (both ways) vs the canonical server-config schema

**Timeout**: 120s
**Isolation**: parallel-safe
**Expected outcome:** GREEN when a sibling server-config checkout exists — every canonical
`fixtures/valid/*.json` passes the orchestrator's REAL `validateAgentEvent` guards, every
`fixtures/invalid/*.json` is rejected, the Kimi conformance stream (`kimi-chain.jsonl`,
R-S1) passes, and every schema closed-enum value (lifecycle, error_reason) is mirrored in
`@dtm/core`. **SKIP-77 hermetic in CI** (no server-config checkout) — never fake-green.

## Scenario

```gherkin
Feature: the TS mirror and the runtime guards conform to the canonical schema, both ways

  Scenario: canonical fixtures vs TS guards
    Given the server-config canonical fixture corpus
    Then all valid fixtures pass and all invalid fixtures reject

  Scenario: schema enums vs @dtm/core mirror
    Given the schema's closed enums
    Then every value appears in the mirror interface
```

## Architecture

```mermaid
flowchart TD
  CANON["server-config agent-event-schema (canonical)"] --> V["valid/*.json -> TS guards: pass"]
  CANON --> I["invalid/*.json -> TS guards: reject"]
  CANON --> K["kimi-chain.jsonl -> TS guards: pass (R-S1)"]
  CANON --> E["closed enums -> @dtm/core mirror: present"]
  NOSC["no sibling checkout"] --> SKIP["SKIP-77 (CI-hermetic)"]
```

## Artifacts

Canonical: `../server-config/setpoint-evals/agent-event-schema/` · guards: `services/orchestrator/src/agent-events/agent-event.guards.ts` · mirror: `packages/core/src/interfaces/agent-event.interface.ts`

## Assertions

- [ ] valid fixtures all pass the real guards
- [ ] invalid fixtures all rejected
- [ ] kimi-chain stream passes (cross-repo R-S1)
- [ ] lifecycle + error_reason enums mirrored in @dtm/core
- [ ] ULID pattern enforced
- [ ] SKIP-77 when the canonical checkout is absent
