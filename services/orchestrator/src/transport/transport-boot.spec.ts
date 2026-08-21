/* eslint-disable @typescript-eslint/no-require-imports -- deliberate: the graph
 * is loaded via require() INSIDE jest.isolateModulesAsync so the isolated module
 * registry (which re-reads the env-at-import const) governs it. `await import()`
 * under module:nodenext can emit a native ESM import that bypasses jest's isolate
 * registry, silently defeating the env re-read this spec depends on. */
/**
 * Phase 0 residual — real module-graph BOOT under the sqs profile.
 *
 * `transport-capabilities.spec.ts` proves the SqsStatusService DI honesty with a
 * MOCK `QueueTransport` token — it never boots the real `TransportModule`, so it
 * cannot catch a break in the profile-selected wiring
 * (`WebSocketModule → TransportModule → SqsTransport → AwsModule/SqsService`).
 * This spec closes that gap: it instantiates the REAL Nest module graph under the
 * sqs profile and asserts the concrete classes resolve and are wired through the
 * `QueueTransport` abstraction (not the concrete `SqsService`).
 *
 * Two hard parts (named in the Phase-0 residual) are solved here:
 *
 *  1. env-at-import — `TransportModule` reads `process.env.QUEUE_TRANSPORT` in a
 *     MODULE-LEVEL const at import time, so setting the env after import is a
 *     no-op. Ambient `QUEUE_TRANSPORT` is unset today (the `|| 'sqs'` fallback),
 *     but any environment that exports `cloud-tasks` would silently flip the graph
 *     and construct a `CloudTasksClient`. We force the profile by setting the env
 *     and re-`require`ing the graph inside `jest.isolateModulesAsync`, so the const
 *     is re-evaluated against our value — deterministic regardless of ambient env.
 *
 *  2. module-identity + the WorkflowRegistryService/repository leaves — because the
 *     graph is required FRESH inside the isolate block, the injection tokens
 *     (`WorkflowRegistryService`, `ConfigService`, `JobRepository`, `StepRepository`)
 *     and the reference classes used for `instanceof` must come from that SAME
 *     registry, or Nest fails to resolve / `instanceof` silently returns false.
 *     Every `require` below therefore lives inside the isolate block. The four
 *     external leaves (normally provided by the @Global WorkflowLoaderModule /
 *     DatabaseModule and a `ConfigModule.forRoot`) are supplied by a small @Global
 *     stub module so the boot stays hermetic — no DB, no workflow loader, no
 *     network. `.compile()` (not `.init()`) instantiates the singletons to prove
 *     wiring without booting the WS server or the @Interval poller.
 */

describe('SE-BOOT — real module graph boots under the sqs profile', () => {
  const ORIGINAL_QT = process.env.QUEUE_TRANSPORT;

  afterEach(() => {
    if (ORIGINAL_QT === undefined) delete process.env.QUEUE_TRANSPORT;
    else process.env.QUEUE_TRANSPORT = ORIGINAL_QT;
    jest.resetModules();
  });

  it('SE-BOOT-sqs: WebSocketModule → TransportModule resolves a native SqsTransport wired through the QueueTransport abstraction', async () => {
    process.env.QUEUE_TRANSPORT = 'sqs';

    let moduleRef: any;
    let SqsTransport: any;
    let SqsService: any;
    let SqsStatusService: any;
    let QueueTransport: any;

    await jest.isolateModulesAsync(async () => {
      // Everything below MUST be required inside the isolate block so the tokens
      // and reference classes share identity with the freshly-loaded graph.
      const { Test } = require('@nestjs/testing');
      const { ConfigService } = require('@nestjs/config');
      const { WorkflowRegistryService } = require('../workflow-loader');
      const { JobRepository, StepRepository } = require('@dtm/database');

      ({ SqsTransport } = require('./sqs-transport.service'));
      ({ SqsService } = require('../aws/sqs.service'));
      ({ QueueTransport } = require('./queue-transport.interface'));
      ({ SqsStatusService } = require('../websocket/sqs-status.service'));
      const { WebSocketModule } = require('../websocket');

      // @Global stub for the external leaves — keeps the boot hermetic (no DB,
      // no workflow loader). A DynamicModule literal sidesteps decorator-in-
      // callback awkwardness and keeps the token identity inside this registry.
      const BootStubModule = {
        module: class BootStubModule {},
        global: true,
        providers: [
          { provide: WorkflowRegistryService, useValue: { getAllQueueNames: () => [] } },
          { provide: ConfigService, useValue: { get: () => undefined } },
          { provide: JobRepository, useValue: {} },
          { provide: StepRepository, useValue: {} },
        ],
        exports: [WorkflowRegistryService, ConfigService, JobRepository, StepRepository],
      };

      moduleRef = await Test.createTestingModule({
        imports: [BootStubModule, WebSocketModule],
      }).compile();
    });

    // The profile-selected transport is the REAL SqsTransport (not a test mock).
    const transport = moduleRef.get(QueueTransport);
    expect(transport).toBeInstanceOf(SqsTransport);
    expect(transport.capabilities.stats).toBe('native');

    // The websocket panel feed (SqsStatusService) got that SAME transport injected
    // through the QueueTransport abstraction — the exact seam the mock spec cannot
    // exercise, and the whole point of the bus-agnosticism decoupling.
    const status = moduleRef.get(SqsStatusService);
    expect(status).toBeInstanceOf(SqsStatusService);
    expect(status.transport).toBe(transport);

    // AwsModule is wired under the sqs profile: the real SqsTransport wraps a real
    // SqsService (proving the AwsModule import in TransportModule's sqs branch).
    expect(transport.sqsService).toBeInstanceOf(SqsService);

    await moduleRef.close();
  });

  it('SE-BOOT-zmq: TransportModule compiles under the zmq profile — ZmqTransport wired through QueueTransport, no socket bound', async () => {
    process.env.QUEUE_TRANSPORT = 'zmq';

    let moduleRef: any;
    let ZmqTransport: any;
    let ZmqWorkerRegistryService: any;
    let QueueTransport: any;

    await jest.isolateModulesAsync(async () => {
      const { Test } = require('@nestjs/testing');
      const { ConfigService } = require('@nestjs/config');
      const { StepRepository } = require('@dtm/database');

      ({ ZmqTransport } = require('./zmq-transport.service'));
      ({ ZmqWorkerRegistryService } = require('./zmq-worker-registry.service'));
      ({ QueueTransport } = require('./queue-transport.interface'));
      const { TransportModule } = require('./transport.module');

      // Same hermetic-stub pattern as the sqs boot spec: ConfigService feeds
      // defaults (no env), StepRepository is a leaf the zmq transport reads
      // the attempt counter from. `.compile()` (not `.init()`) instantiates
      // the singletons WITHOUT binding the ROUTER (onModuleInit never fires).
      const BootStubModule = {
        module: class BootStubModule {},
        global: true,
        providers: [
          { provide: ConfigService, useValue: { get: (_k: string, d: unknown) => d } },
          { provide: StepRepository, useValue: {} },
        ],
        exports: [ConfigService, StepRepository],
      };

      moduleRef = await Test.createTestingModule({
        imports: [BootStubModule, TransportModule],
      }).compile();
    });

    const transport = moduleRef.get(QueueTransport);
    expect(transport).toBeInstanceOf(ZmqTransport);
    expect(transport.capabilities.redelivery).toBe('orchestrator');
    // No AwsModule under zmq: the SQS concrete is not in this graph at all.
    expect(() => moduleRef.get('SqsTransport', { strict: false })).toThrow();

    // THE Phase 2 boot-bug pin: the concrete token and the QueueTransport
    // token MUST resolve to the SAME instance. Two instances each bind the
    // ROUTER in onModuleInit → the second dies on EADDRINUSE and the whole
    // bootstrap exits 1 before ever logging "ROUTER bound".
    expect(moduleRef.get(ZmqTransport)).toBe(transport);

    const registry = moduleRef.get(ZmqWorkerRegistryService);
    expect(registry).toBeInstanceOf(ZmqWorkerRegistryService);
    expect(registry.listWorkers()).toEqual([]);

    await moduleRef.close();
  });

  it('SE-BOOT-profile-select: QUEUE_TRANSPORT drives provider selection at import time (env-at-import), no GCP client constructed', async () => {
    // sqs profile: TransportModule wires the SqsTransport concrete.
    process.env.QUEUE_TRANSPORT = 'sqs';
    await jest.isolateModulesAsync(async () => {
      const { SqsTransport } = require('./sqs-transport.service');
      const { CloudTasksTransport } = require('./cloud-tasks-transport.service');
      const { TransportModule } = require('./transport.module');

      const providers = Reflect.getMetadata('providers', TransportModule);
      expect(providers).toEqual(expect.arrayContaining([SqsTransport]));
      expect(providers).not.toEqual(expect.arrayContaining([CloudTasksTransport]));
    });

    // cloud-tasks profile: selection FLIPS at import time. We only read the module
    // metadata — no `.compile()`, so CloudTasksClient is never constructed (this
    // spec must not depend on live GCP credentials or the cloud-tasks wiring lane).
    process.env.QUEUE_TRANSPORT = 'cloud-tasks';
    await jest.isolateModulesAsync(async () => {
      const { SqsTransport } = require('./sqs-transport.service');
      const { CloudTasksTransport } = require('./cloud-tasks-transport.service');
      const { TransportModule } = require('./transport.module');

      const providers = Reflect.getMetadata('providers', TransportModule);
      expect(providers).toEqual(expect.arrayContaining([CloudTasksTransport]));
      expect(providers).not.toEqual(expect.arrayContaining([SqsTransport]));
    });

    // zmq profile (Phase 2): the zmq lane wires the worker registry plus ONE
    // ZmqTransport instance behind both tokens (useClass for QueueTransport,
    // useExisting for the concrete) and NO AWS/GCP transport concrete.
    // Metadata-only read — the ROUTER never binds without a module init.
    process.env.QUEUE_TRANSPORT = 'zmq';
    await jest.isolateModulesAsync(async () => {
      const { SqsTransport } = require('./sqs-transport.service');
      const { CloudTasksTransport } = require('./cloud-tasks-transport.service');
      const { ZmqTransport } = require('./zmq-transport.service');
      const { ZmqWorkerRegistryService } = require('./zmq-worker-registry.service');
      const { ZmqWorkersController } = require('./zmq-workers.controller');
      const { QueueTransport } = require('./queue-transport.interface');
      const { TransportModule } = require('./transport.module');

      const providers = Reflect.getMetadata('providers', TransportModule);
      expect(providers).toEqual(expect.arrayContaining([ZmqWorkerRegistryService]));
      expect(providers).not.toEqual(expect.arrayContaining([SqsTransport, CloudTasksTransport]));

      // Single-instance wiring (the Phase 2 EADDRINUSE boot-bug pin): the class
      // appears only as useClass behind QueueTransport, never as a standalone
      // concrete provider that would instantiate a second ROUTER-binding copy.
      expect(providers).toEqual(
        expect.arrayContaining([
          { provide: QueueTransport, useClass: ZmqTransport },
          { provide: ZmqTransport, useExisting: QueueTransport },
        ]),
      );
      expect(providers).not.toEqual(expect.arrayContaining([ZmqTransport]));

      // The /workers introspection endpoint exists ONLY under the zmq profile.
      const controllers = Reflect.getMetadata('controllers', TransportModule);
      expect(controllers).toEqual(expect.arrayContaining([ZmqWorkersController]));
    });
  });
});
