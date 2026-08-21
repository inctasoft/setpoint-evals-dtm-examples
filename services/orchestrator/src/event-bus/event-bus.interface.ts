/**
 * EventBus — pluggable event-bus abstraction (Phase 3 of the bus-agnosticism
 * program). DISJOINT from QueueTransport (the task path): events
 * (transformed-data publishes, job lifecycle events, acknowledgements) travel
 * this abstraction; step dispatches travel QueueTransport. The two never merge.
 *
 * Implementations: KafkaEventBus (brokered, today's behavior byte-equivalent),
 * ZmqEventBus (PUB/SUB events + PUSH/PULL ack return).
 */

/** A parsed event delivered to a subscriber: (topic, decoded message). */
export type EventBusMessageHandler = (topic: string, message: unknown) => Promise<void>;

/**
 * Declared, honest capability contract for an event bus. Consumers branch on
 * these instead of assuming Kafka-shaped behavior.
 *
 * `droppedPublishRecovery` — who recovers a publish that never reached a
 * consumer?
 *   'bus'          — brokered durability: the bus persists the publish and a
 *                    late-joining consumer still receives it (Kafka). The
 *                    30-minute stuck-acknowledgement task remains the only
 *                    net, byte-identical to pre-Phase-3 behavior.
 *   'orchestrator' — drops are realistic: a fire-and-forget pub/sub socket
 *                    silently discards when no subscriber is attached (zmq).
 *                    The EventRepublishScanTask owns re-publishing un-ACKed
 *                    steps on a short interval (the A5 gap-closer).
 */
export interface EventBusCapabilities {
  droppedPublishRecovery: 'bus' | 'orchestrator';
}

/**
 * Is the proactive event-republish scan active for this deployment?
 * True only when the active bus declares `droppedPublishRecovery:
 * 'orchestrator'` or the EVENT_REPUBLISH_SCAN_FORCE_ENABLED escape hatch
 * (setpoint evals) forces it on. Under the default Kafka bus this is false
 * and the scan is a complete no-op — the 30-minute stuck-ack behavior is
 * byte-identical to today.
 */
export function isEventRepublishScanActive(
  capabilities: EventBusCapabilities,
  forceEnabled: boolean,
): boolean {
  return capabilities.droppedPublishRecovery === 'orchestrator' || forceEnabled;
}

/**
 * Pluggable event bus interface.
 * Implementations: KafkaEventBus (Kafka broker), ZmqEventBus (ZeroMQ
 * PUB/SUB + PUSH/PULL sockets).
 */
export abstract class EventBus {
  /** Declared capabilities — consumers branch on these, never on the concrete class. */
  abstract readonly capabilities: EventBusCapabilities;

  /**
   * Publish an event to a topic. Returns true when the bus accepted it —
   * NOTE for drop-realistic buses (capabilities.droppedPublishRecovery ===
   * 'orchestrator'): acceptance does NOT imply any subscriber received it;
   * recovery is the republish scan's job, not a false return value.
   */
  abstract publish<T = unknown>(topic: string, message: T, key?: string): Promise<boolean>;

  /** Register a handler for a topic. Multiple topics per handler are fine. */
  abstract subscribe(topic: string, handler: EventBusMessageHandler): Promise<void>;

  /**
   * Lifecycle hook for buses that need an explicit start AFTER all
   * subscriptions are registered (the Kafka consumer's startConsuming).
   * No-op for buses that are live on bind.
   */
  abstract start(): Promise<void>;

  abstract isConnected(): boolean;

  abstract healthCheck(): { healthy: boolean; message: string };
}
