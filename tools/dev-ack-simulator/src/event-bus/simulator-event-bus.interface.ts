/**
 * Simulator Event Bus — bus-neutral client contract for the dev-ack-simulator
 * (Phase 3 of the bus-agnosticism program).
 *
 * The simulator needs exactly two verbs: PUBLISH acks and (on the zmq
 * profile) SUBSCRIBE to completion topics. The Kafka profile satisfies this
 * with the existing KafkaService (byte-identical); the zmq profile uses the
 * ZmqEventBusClient below.
 */

export interface SimulatorEventBus {
  publish(topic: string, message: Record<string, unknown>): Promise<boolean>;
}

/** NestJS injection token for the simulator's event bus client. */
export const SIMULATOR_EVENT_BUS = Symbol("SIMULATOR_EVENT_BUS");
