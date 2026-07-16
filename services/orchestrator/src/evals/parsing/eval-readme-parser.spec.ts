import { parseMetadata, parsePayload, parseScenario, parseTitle } from './eval-readme-parser';

const WRAPPED_METADATA_README = `# SE-06: stuck in-progress detection

## Setpoint Eval Metadata

**Category**: maintenance · **Duration**: ~30s (per test.sh's own banner) · **Timeout**: 120s · **Isolation**: destructive

## Scenario
\`\`\`gherkin
Feature: the stuck-in-progress maintenance task alerts on hung steps (alert-only)
  Scenario: a step manually stuck in IN_PROGRESS is detected but not auto-fixed
    Given order-processing is running with customer_id=1
    When ValidateCustomer is manually set back to in_progress
    Then the task finds at least 1 stuck step
\`\`\`

## Payload

### Job payload
\`\`\`json
{
  "variant": "quick-order",
  "payload": {
    "customerId": 1,
    "orderId": 1,
    "entityId": "<uuidgen per run>"
  },
  "enableDeduplication": false
}
\`\`\`

### Maintenance task invocation
\`\`\`bash
curl -X POST ...
\`\`\`

## Artifacts
Some artifacts text.

## Assertions
- [ ] finds the stuck step
`;

const BARE_METADATA_README = `# SE-14: schema single source

**Category**: schema · **Isolation**: destructive · **Duration**: ~10s · **Timeout**: 120s

**MUST RUN SEQUENTIALLY** — this SE drops and rebuilds the schema.

## Scenario
\`\`\`gherkin
Feature: Migrations are the single schema source of truth
  Scenario: bootstrap path and fresh migrate produce identical schemas
    Given a running dtm-db Postgres instance
    Then their information_schema are byte-identical
\`\`\`
`;

const MALFORMED_PAYLOAD_README = `# SE-18: malformed payload

## Setpoint Eval Metadata

**Category**: evals-module · **Duration**: ~5s · **Timeout**: 30s · **Isolation**: parallel-safe

## Scenario
\`\`\`gherkin
Feature: malformed payload
  Scenario: broken json
    Given a README with a broken Payload block
    Then discovery still returns the eval
\`\`\`

## Payload
\`\`\`json
{ "variant": "default", "payload": { "oops": , } }
\`\`\`
`;

describe('eval-readme-parser', () => {
  describe('parseTitle', () => {
    it('extracts the H1 title', () => {
      expect(parseTitle(WRAPPED_METADATA_README)).toBe('SE-06: stuck in-progress detection');
    });

    it('returns undefined when there is no H1', () => {
      expect(parseTitle('## Scenario\nfoo')).toBeUndefined();
    });
  });

  describe('parseMetadata', () => {
    it('parses fields from a "## Setpoint Eval Metadata" wrapped block', () => {
      const metadata = parseMetadata(WRAPPED_METADATA_README);
      expect(metadata.category).toBe('maintenance');
      expect(metadata.duration).toBe(`~30s (per test.sh's own banner)`);
      expect(metadata.timeout).toBe('120s');
      expect(metadata.isolation).toBe('destructive');
    });

    it('tolerantly parses the pre-v2 bare-bold-line shape (no metadata heading)', () => {
      const metadata = parseMetadata(BARE_METADATA_README);
      expect(metadata.category).toBe('schema');
      expect(metadata.isolation).toBe('destructive');
      expect(metadata.duration).toBe('~10s');
      expect(metadata.timeout).toBe('120s');
    });

    it('degrades to an empty object (no crash) when no metadata is present at all', () => {
      expect(parseMetadata('# Title\n\n## Scenario\nno bold fields here')).toEqual({});
    });
  });

  describe('parseScenario', () => {
    it('extracts the gherkin block under "## Scenario"', () => {
      const scenario = parseScenario(WRAPPED_METADATA_README);
      expect(scenario).toContain('Feature: the stuck-in-progress maintenance task');
      expect(scenario).toContain('Given order-processing is running with customer_id=1');
      expect(scenario).not.toContain('```');
    });

    it('returns undefined when there is no "## Scenario" section', () => {
      expect(parseScenario('# Title\n\n## Payload\n```json\n{}\n```')).toBeUndefined();
    });
  });

  describe('parsePayload', () => {
    it('extracts and parses the json fence, even nested under a "### Job payload" sub-heading', () => {
      const payload = parsePayload(WRAPPED_METADATA_README);
      expect(payload).toBeDefined();
      expect(payload!.parseError).toBeUndefined();
      expect(payload!.json).toEqual({
        variant: 'quick-order',
        payload: { customerId: 1, orderId: 1, entityId: '<uuidgen per run>' },
        enableDeduplication: false,
      });
    });

    it('does NOT bleed into a later section (## Artifacts) past the next level-2 heading', () => {
      const withTrailingJsonInArtifacts = `${WRAPPED_METADATA_README}\n\`\`\`json\n{"shouldNot":"beFound"}\n\`\`\`countryside`;
      const payload = parsePayload(withTrailingJsonInArtifacts);
      expect(payload!.json).not.toHaveProperty('shouldNot');
    });

    it('returns undefined when there is no "## Payload" section (e.g. SE-14/SE-15)', () => {
      expect(parsePayload(BARE_METADATA_README)).toBeUndefined();
    });

    it('returns a parseError (not a throw) for malformed JSON', () => {
      const payload = parsePayload(MALFORMED_PAYLOAD_README);
      expect(payload).toBeDefined();
      expect(payload!.json).toBeUndefined();
      expect(payload!.parseError).toBeDefined();
      expect(payload!.raw).toContain('oops');
    });
  });
});
