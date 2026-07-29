import { WorkflowConfigService } from './workflow-config.service';

/**
 * Phase 3 — bus-neutral topic rename (operator decision D-D), RED-first.
 *
 * `eventTopic` is the primary name for a cascade's publish topic going
 * forward; `kafkaTopic` is the compat alias. Readers resolve via the config
 * service (accept both, prefer new) so one release of mixed config versions
 * keeps working — exactly the Phase 1 attemptNumber/taskHandle pattern.
 */
describe('Phase 3 — cascade eventTopic resolution (D-D rename)', () => {
  function makeConfig(kafkaTopic?: string, eventTopic?: string): WorkflowConfigService {
    return new WorkflowConfigService({
      name: 'test-workflow',
      steps: {},
      cascades: [
        {
          cascadeName: 'customer',
          outputStep: 'SubmitCustomer',
          dependsOn: [],
          ...(kafkaTopic !== undefined ? { kafkaTopic } : {}),
          ...(eventTopic !== undefined ? { eventTopic } : {}),
        },
      ],
    } as never);
  }

  it('SE-DD-legacy: a config carrying only the kafkaTopic alias resolves it', () => {
    const cfg = makeConfig('wf.customer.completed');

    expect(cfg.getCascadeEventTopic('customer')).toBe('wf.customer.completed');
  });

  it('SE-DD-preferred: eventTopic WINS when both names are present', () => {
    const cfg = makeConfig('wf.customer.completed', 'wf.customer.done');

    expect(cfg.getCascadeEventTopic('customer')).toBe('wf.customer.done');
  });

  it('SE-DD-missing: an unknown cascade resolves to undefined (callers skip, never throw)', () => {
    const cfg = makeConfig('wf.customer.completed');

    expect(cfg.getCascadeEventTopic('nope')).toBeUndefined();
  });
});
