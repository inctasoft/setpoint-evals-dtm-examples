/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: the graph
 * is loaded via require() INSIDE jest.isolateModulesAsync so the isolated module
 * registry (which re-reads the env-at-import const) governs it — same pattern as
 * transport-boot.spec.ts. */

/**
 * Phase 3 — EventBusModule profile selection boot spec (RED-first).
 *
 * `EventBusModule` reads `process.env.EVENT_BUS` in a MODULE-LEVEL const at
 * import time, so the env must be set before requiring the graph inside
 * jest.isolateModulesAsync. Pins:
 *  - kafka profile: KafkaEventBus behind the EventBus token, ZmqEventBus absent
 *  - zmq profile: ZmqEventBus behind the token, KafkaEventBus absent, and —
 *    the Phase 2 lesson — BOTH tokens resolve to the SAME instance
 *    (useExisting), so no duplicate socket binds can ever happen.
 */
describe('SE-EBUS-BOOT — EventBusModule profile selection', () => {
  const ORIGINAL_EB = process.env.EVENT_BUS;

  afterEach(() => {
    if (ORIGINAL_EB === undefined) delete process.env.EVENT_BUS;
    else process.env.EVENT_BUS = ORIGINAL_EB;
    jest.resetModules();
  });

  it('SE-EBUS-profile-select: EVENT_BUS drives provider selection at import time', async () => {
    process.env.EVENT_BUS = 'kafka';
    await jest.isolateModulesAsync(async () => {
      const { KafkaEventBus } = require('./kafka-event-bus.service');
      const { ZmqEventBus } = require('./zmq-event-bus.service');
      const { EventBusModule } = require('./event-bus.module');

      const providers = Reflect.getMetadata('providers', EventBusModule);
      expect(providers).toEqual(expect.arrayContaining([KafkaEventBus]));
      expect(providers).not.toEqual(expect.arrayContaining([ZmqEventBus]));
    });

    process.env.EVENT_BUS = 'zmq';
    await jest.isolateModulesAsync(async () => {
      const { KafkaEventBus } = require('./kafka-event-bus.service');
      const { ZmqEventBus } = require('./zmq-event-bus.service');
      const { EventBus } = require('./event-bus.interface');
      const { EventBusModule } = require('./event-bus.module');

      const providers = Reflect.getMetadata('providers', EventBusModule);
      expect(providers).toEqual(expect.arrayContaining([ZmqEventBus]));
      expect(providers).not.toEqual(expect.arrayContaining([KafkaEventBus]));
      // Single-instance wiring (the Phase 2 EADDRINUSE lesson, applied from
      // the start): the EventBus token ALIASES the concrete, never useClass.
      expect(providers).toEqual(
        expect.arrayContaining([{ provide: EventBus, useExisting: ZmqEventBus }]),
      );
    });
  });

  it('SE-EBUS-BOOT-zmq: zmq profile compiles hermetically — one ZmqEventBus behind both tokens, no socket bound', async () => {
    process.env.EVENT_BUS = 'zmq';

    let moduleRef: any;
    let ZmqEventBus: any;
    let EventBus: any;

    await jest.isolateModulesAsync(async () => {
      const { Test } = require('@nestjs/testing');
      const { ConfigService } = require('@nestjs/config');

      ({ ZmqEventBus } = require('./zmq-event-bus.service'));
      ({ EventBus } = require('./event-bus.interface'));
      const { EventBusModule } = require('./event-bus.module');

      const BootStubModule = {
        module: class BootStubModule {},
        global: true,
        providers: [{ provide: ConfigService, useValue: { get: (_k: string, d: unknown) => d } }],
        exports: [ConfigService],
      };

      moduleRef = await Test.createTestingModule({
        imports: [BootStubModule, EventBusModule],
      }).compile();
    });

    const bus = moduleRef.get(EventBus);
    expect(bus).toBeInstanceOf(ZmqEventBus);
    // The Phase 2 pin: both tokens MUST be the same instance (two instances
    // would double-bind the PUB/PULL sockets on module init).
    expect(moduleRef.get(ZmqEventBus)).toBe(bus);
    expect(bus.capabilities.droppedPublishRecovery).toBe('orchestrator');

    await moduleRef.close();
  });
});
