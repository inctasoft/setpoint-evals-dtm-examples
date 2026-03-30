/**
 * AckSubscription — describes one topic pair that the simulator should handle.
 *
 * Derived at startup from WorkflowDefinition.cascades.
 * Each entry tells the simulator:
 *   - Which Kafka topic to LISTEN on for completed submit messages
 *   - Which Kafka topic to PUBLISH the simulated ACK to
 *   - Which step name to use for testOptions lookup
 *   - Which cascade name to use for ack-defaults lookup
 */
export interface AckSubscription {
  /** Kafka topic to listen on (e.g., "order.consumer.completed") */
  listenTopic: string;

  /** Kafka topic to publish ACK to (e.g., "order.consumer.ack") */
  ackTopic: string;

  /** Submit step name for testOptions lookup (e.g., "SubmitCustomer") */
  outputStep: string;

  /** Cascade name for ack-defaults lookup (e.g., "customer") */
  cascadeName: string;

  /**
   * Alternative step names that should also match for testOptions lookup.
   * Example: Orders fan-out uses "SubmitOrder" (singular) but legacy uses "SubmitOrders" (plural).
   */
  alternateStepNames?: string[];
}

/** NestJS injection token for AckSubscription[] */
export const ACK_SUBSCRIPTIONS = Symbol("ACK_SUBSCRIPTIONS");
