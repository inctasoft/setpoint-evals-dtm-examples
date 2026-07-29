import { Test } from '@nestjs/testing';
import { QueueTransport, TaskTransportCapabilities } from './queue-transport.interface';
import { SqsStatusService } from '../websocket/sqs-status.service';
import { EventsGateway } from '../websocket/events.gateway';
import { SqsTransport } from './sqs-transport.service';
import { CloudTasksTransport } from './cloud-tasks-transport.service';

/**
 * Phase 0 — interface honesty + latent DI-coupling fix.
 *
 * These are the RED-first setpoint evals for the SqsStatusService transport
 * bypass logged in DIFFICULTIES-LOG (2026-07-22 bus-agnosticism seam analysis):
 * the websocket SQS panel injected `SqsService` DIRECTLY, so it could only ever
 * be wired in a graph that also provides the AWS module. That coupling is latent
 * today (app.module imports AwsModule unconditionally) but is fatal the moment a
 * non-AWS profile (cloud-tasks / zmq) drops AwsModule — which is the entire point
 * of the bus-agnosticism work.
 *
 * The honest fix: the panel feed goes through the `QueueTransport` abstraction and
 * is gated on a declared `TaskTransportCapabilities.stats` capability, so a
 * stats-less transport (`stats: 'none'`) neither requires SqsService nor emits
 * fabricated queue rows.
 */
describe('Phase 0 — TaskTransportCapabilities + SqsStatusService transport honesty', () => {
  const eventsGateway = { broadcast: jest.fn() };

  function makeTransport(overrides: Partial<QueueTransport> = {}): QueueTransport {
    return {
      capabilities: {
        stats: 'native',
        redelivery: 'bus',
        attemptCounter: 'native',
        dlq: 'native',
      } as TaskTransportCapabilities,
      sendTask: jest.fn(),
      getQueueStatuses: jest.fn().mockResolvedValue([]),
      getWorkerEndpointUrl: jest.fn(),
      healthCheck: jest.fn(),
      ...overrides,
    } as unknown as QueueTransport;
  }

  beforeEach(() => jest.clearAllMocks());

  it('SE-DI: SqsStatusService resolves in an AWS-free graph (no SqsService provider)', async () => {
    // The whole point of the fix: this DI graph provides NO SqsService — exactly
    // what a cloud-tasks / zmq profile looks like. Pre-fix this compile threw
    // "Nest can't resolve dependencies of SqsStatusService" (RED).
    const moduleRef = await Test.createTestingModule({
      providers: [
        SqsStatusService,
        { provide: QueueTransport, useValue: makeTransport() },
        { provide: EventsGateway, useValue: eventsGateway },
      ],
    }).compile();

    expect(moduleRef.get(SqsStatusService)).toBeInstanceOf(SqsStatusService);
  });

  it("SE-STATS-none: a stats:'none' transport broadcasts nothing and never touches the bus", async () => {
    const transport = makeTransport({
      capabilities: {
        stats: 'none',
        redelivery: 'bus',
        attemptCounter: 'synthetic',
        dlq: 'table',
      } as TaskTransportCapabilities,
    });
    const svc = new SqsStatusService(transport, eventsGateway as unknown as EventsGateway);

    await svc.pollAndBroadcast();

    expect(transport.getQueueStatuses).not.toHaveBeenCalled();
    expect(eventsGateway.broadcast).not.toHaveBeenCalled();
  });

  it("SE-STATS-native: a stats:'native' transport feeds the panel through the abstraction", async () => {
    const rows = [{ name: 'dtm-validate', available: 3, inFlight: 1, dlq: 0 }];
    const transport = makeTransport({
      capabilities: {
        stats: 'native',
        redelivery: 'bus',
        attemptCounter: 'native',
        dlq: 'native',
      } as TaskTransportCapabilities,
      getQueueStatuses: jest.fn().mockResolvedValue(rows),
    });
    const svc = new SqsStatusService(transport, eventsGateway as unknown as EventsGateway);

    await svc.pollAndBroadcast();

    expect(transport.getQueueStatuses).toHaveBeenCalledTimes(1);
    expect(eventsGateway.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sqs_status', queues: rows }),
    );
  });
});

/**
 * Phase 1 — redelivery capability axes.
 *
 * The redelivery engine activates ONLY when the active transport declares
 * `redelivery: 'orchestrator'` (or the REDELIVERY_ENGINE_FORCE_ENABLED escape
 * hatch is set). These pins keep every transport's declaration honest so the
 * engine can never silently activate under a bus that already redelivers
 * natively (double redelivery = duplicate worker executions).
 */
describe('Phase 1 — redelivery / attemptCounter / dlq capability axes', () => {
  it('SqsTransport declares full native bus redelivery (engine stays off)', () => {
    const transport = new SqsTransport({} as never, {} as never);

    expect(transport.capabilities).toEqual({
      stats: 'native',
      redelivery: 'bus',
      attemptCounter: 'native',
      dlq: 'native',
    });
  });

  it('CloudTasksTransport declares honest values (native retry, no native DLQ, no surfaced attempt count)', () => {
    const transport = new CloudTasksTransport();

    expect(transport.capabilities).toEqual({
      stats: 'none',
      redelivery: 'bus',
      attemptCounter: 'synthetic',
      dlq: 'table',
    });
  });
});
