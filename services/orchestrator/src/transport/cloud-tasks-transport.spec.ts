import { CloudTasksTransport } from './cloud-tasks-transport.service';

/**
 * Hermetic module-load proof for the Cloud Tasks profile.
 *
 * The Phase-0 `transport-capabilities.spec.ts` verifies the panel/DI honesty
 * using a *mock* transport — it never imports the real `CloudTasksTransport`, so
 * it does not prove the `@google-cloud/tasks` dependency actually resolves nor
 * that the class boots without a GCP round-trip. The bus-agnosticism phases
 * (Phases 1-5) need the cloud-tasks profile module to LOAD hermetically before
 * they can build on it; this is that proof.
 *
 * The `import` above is itself the dep-resolution assertion: if
 * `@google-cloud/tasks` were missing from the lockfile (the regression PR #14
 * fixed), this module would throw at load and the whole file would fail RED.
 *
 * DELIBERATELY constructor/DI-level only. `CloudTasksClient` is instantiated in
 * `onModuleInit()`, never the constructor, so nothing here touches GCP — no
 * network, no credentials, no emulator. We never call `onModuleInit()`.
 */
describe('CloudTasksTransport — hermetic load (no GCP calls)', () => {
  it('imports and constructs without touching GCP', () => {
    const transport = new CloudTasksTransport();
    expect(transport).toBeInstanceOf(CloudTasksTransport);
  });

  it("declares stats capability 'none' (Cloud Tasks has no per-queue depth API)", () => {
    const transport = new CloudTasksTransport();
    expect(transport.capabilities.stats).toBe('none');
  });

  it('getQueueStatuses resolves an empty list without a client', async () => {
    const transport = new CloudTasksTransport();
    await expect(transport.getQueueStatuses()).resolves.toEqual([]);
  });

  it('healthCheck reports unhealthy before onModuleInit (client not yet created)', () => {
    const transport = new CloudTasksTransport();
    const health = transport.healthCheck();
    expect(health.healthy).toBe(false);
    expect(typeof health.message).toBe('string');
  });
});
