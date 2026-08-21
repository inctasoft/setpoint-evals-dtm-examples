import { ConfigService } from '@nestjs/config';
import { EventBus, EventBusCapabilities, isEventRepublishScanActive } from './event-bus.interface';
import { KafkaEventBus } from './kafka-event-bus.service';
import { ZmqEventBus } from './zmq-event-bus.service';

/**
 * Phase 3 — EventBus capability contract (RED-first).
 *
 * Mirrors the Phase 1 TaskTransportCapabilities discipline: consumers (the
 * republish scan, health surfaces) branch on DECLARED capabilities, never on
 * the concrete class. The Kafka bus must declare brokered recovery (so the
 * 30-minute stuck-ack task stays the only net, byte-identical); the zmq bus
 * must honestly declare that drops are realistic.
 */
describe('Phase 3 — EventBus capability axes', () => {
  it('KafkaEventBus declares brokered dropped-publish recovery (republish scan stays off)', () => {
    const bus = new KafkaEventBus({} as never, {} as never);

    expect(bus.capabilities).toEqual({
      droppedPublishRecovery: 'bus',
    } satisfies EventBusCapabilities);
    expect(isEventRepublishScanActive(bus.capabilities, false)).toBe(false);
  });

  it('ZmqEventBus honestly declares drops-realistic recovery (republish scan activates)', () => {
    const config = { get: (_k: string, d: unknown) => d } as unknown as ConfigService;
    const bus = new ZmqEventBus(config);

    expect(bus.capabilities).toEqual({
      droppedPublishRecovery: 'orchestrator',
    } satisfies EventBusCapabilities);
    expect(isEventRepublishScanActive(bus.capabilities, false)).toBe(true);
  });

  it('the escape hatch forces the scan on even under a brokered bus (SE vehicle)', () => {
    const bus = new KafkaEventBus({} as never, {} as never);

    expect(isEventRepublishScanActive(bus.capabilities, true)).toBe(true);
  });

  it('both implementations satisfy the EventBus abstraction', () => {
    const config = { get: (_k: string, d: unknown) => d } as unknown as ConfigService;

    expect(new KafkaEventBus({} as never, {} as never)).toBeInstanceOf(EventBus);
    expect(new ZmqEventBus(config)).toBeInstanceOf(EventBus);
  });
});
