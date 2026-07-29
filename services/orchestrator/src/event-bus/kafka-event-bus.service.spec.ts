import { KafkaEventBus } from './kafka-event-bus.service';
import { KafkaService } from '../kafka/kafka.service';
import { KafkaConsumerService } from '@dtm/kafka-consumer';

/**
 * Phase 3 — KafkaEventBus byte-equivalence (RED-first).
 *
 * The Kafka implementation must be a THIN adapter over the existing
 * KafkaService / KafkaConsumerService: identical arguments in, identical
 * booleans out, identical call ordering (connect → subscribe ×N →
 * startConsuming). Any drift here breaks the aws estate, whose green run is
 * the extraction's proof.
 */
describe('Phase 3 — KafkaEventBus byte-equivalence', () => {
  let kafkaService: { publish: jest.Mock; isConnected: jest.Mock };
  let consumer: {
    connect: jest.Mock;
    subscribe: jest.Mock;
    registerHandler: jest.Mock;
    startConsuming: jest.Mock;
  };
  let bus: KafkaEventBus;

  beforeEach(() => {
    kafkaService = {
      publish: jest.fn(async () => true),
      isConnected: jest.fn(() => true),
    };
    consumer = {
      connect: jest.fn(async () => undefined),
      subscribe: jest.fn(async () => undefined),
      registerHandler: jest.fn(),
      startConsuming: jest.fn(async () => undefined),
    };
    bus = new KafkaEventBus(
      kafkaService as unknown as KafkaService,
      consumer as unknown as KafkaConsumerService,
    );
  });

  it('SE-BUS-publish: publish delegates to KafkaService.publish with identical topic/message/key and returns its boolean', async () => {
    const event = { jobId: 'j-1', recordCount: 3 };

    const ok = await bus.publish('order-processing.customer.completed', event, 'j-1');

    expect(ok).toBe(true);
    expect(kafkaService.publish).toHaveBeenCalledTimes(1);
    expect(kafkaService.publish).toHaveBeenCalledWith(
      'order-processing.customer.completed',
      event,
      'j-1',
    );

    kafkaService.publish.mockResolvedValueOnce(false);
    expect(await bus.publish('t', {}, undefined)).toBe(false);
  });

  it('SE-BUS-subscribe: first subscribe connects the consumer once; each topic registers a handler and subscribes', async () => {
    const handler = jest.fn(async () => undefined);

    await bus.subscribe('dtm.order.ack', handler);
    await bus.subscribe('dtm.customer.ack', handler);

    expect(consumer.connect).toHaveBeenCalledTimes(1);
    expect(consumer.registerHandler).toHaveBeenCalledTimes(2);
    expect(consumer.registerHandler.mock.calls[0][0]).toBe('dtm.order.ack');
    expect(consumer.subscribe).toHaveBeenCalledTimes(2);
    expect(consumer.subscribe).toHaveBeenCalledWith({
      topic: 'dtm.customer.ack',
      fromBeginning: false,
    });
    // startConsuming is NOT called by subscribe — the explicit start() owns it.
    expect(consumer.startConsuming).not.toHaveBeenCalled();
  });

  it('SE-BUS-adapter: the registered kafkajs handler parses the value and delivers (topic, message)', async () => {
    const handler = jest.fn(async () => undefined);
    await bus.subscribe('dtm.order.ack', handler);

    const adapter = consumer.registerHandler.mock.calls[0][1];
    await adapter.handleMessage({
      topic: 'dtm.order.ack',
      message: { value: Buffer.from(JSON.stringify({ jobId: 'j-1', stepId: 's-1' })) },
    });

    expect(handler).toHaveBeenCalledWith('dtm.order.ack', { jobId: 'j-1', stepId: 's-1' });
  });

  it('SE-BUS-adapter-poison: an unparseable value throws (same DLQ routing as today)', async () => {
    const handler = jest.fn(async () => undefined);
    await bus.subscribe('dtm.order.ack', handler);

    const adapter = consumer.registerHandler.mock.calls[0][1];
    await expect(
      adapter.handleMessage({
        topic: 'dtm.order.ack',
        message: { value: Buffer.from('not json') },
      }),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('SE-BUS-start: start() runs startConsuming exactly once across repeated calls', async () => {
    await bus.start();
    await bus.start();

    expect(consumer.startConsuming).toHaveBeenCalledTimes(1);
  });

  it('SE-BUS-health: isConnected delegates to KafkaService.isConnected', () => {
    expect(bus.isConnected()).toBe(true);
    kafkaService.isConnected.mockReturnValue(false);
    expect(bus.isConnected()).toBe(false);
  });
});
