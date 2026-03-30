/**
 * Payload builders for each STE eval.
 * Each function returns the exact JSON payload that the corresponding bash test.sh sends.
 */

/**
 * Eval 01: Retry Transient Failure
 * ValidateCustomer and SubmitOrder fail on attempts 1 & 2, succeed on attempt 3.
 * Uses quick-order variant (4 steps).
 */
export function retryTransientFailurePayload(): Record<string, unknown> {
  return {
    variant: 'quick-order',
    payload: { entityId: crypto.randomUUID(), customerId: 1, orderId: 1 },
    enableDeduplication: false,
    testOptions: {
      ValidateCustomer: { simDelay: 500, failOnAttempts: [1, 2], failureAfter: 100 },
      ValidateProduct: { simDelay: 500 },
      SubmitCustomer: { simDelay: 500, ackDelay: 1000 },
      SubmitOrder: { simDelay: 500, failOnAttempts: [1, 2], failureAfter: 100, ackDelay: 1000 },
    },
  };
}

/**
 * Eval 02: DLQ Permanent Failure
 * SubmitOrder fails on ALL attempts (7), eventually routed to DLQ.
 * Other steps recover after transient failures.
 */
export function dlqPermanentFailurePayload(): Record<string, unknown> {
  return {
    variant: 'quick-order',
    payload: { entityId: crypto.randomUUID(), customerId: 1, orderId: 1 },
    enableDeduplication: false,
    testOptions: {
      ValidateCustomer: { simDelay: 500, failOnAttempts: [1, 2] },
      ValidateProduct: { simDelay: 500, failOnAttempts: [1] },
      SubmitCustomer: { simDelay: 500, ackDelay: 100, failOnAttempts: [1, 2] },
      SubmitOrder: { simDelay: 500, ackDelay: 100, failOnAttempts: [1, 2, 3, 4, 5, 6, 7] },
    },
  };
}

/**
 * Eval 03: Deduplication - First request payload
 * Uses enableDeduplication: true. Longer delays to keep job active during duplicate test.
 */
export function deduplicationPayload(deduplicationKey: string): Record<string, unknown> {
  return {
    deduplicationKey,
    variant: 'quick-order',
    payload: { entityId: deduplicationKey, customerId: 1, orderId: 1 },
    enableDeduplication: true,
    testOptions: {
      ValidateCustomer: { simDelay: 2000 },
      ValidateProduct: { simDelay: 2000 },
      SubmitCustomer: { simDelay: 2000, ackDelay: 1000 },
      SubmitOrder: { simDelay: 2000, ackDelay: 1000 },
    },
  };
}

/**
 * Eval 03: Deduplication - Second (different) request
 * Shorter delays since it just needs to complete.
 */
export function deduplicationDifferentPayload(deduplicationKey: string): Record<string, unknown> {
  return {
    deduplicationKey,
    variant: 'quick-order',
    payload: { entityId: deduplicationKey, customerId: 1, orderId: 1 },
    enableDeduplication: true,
    testOptions: {
      ValidateCustomer: { simDelay: 1000 },
      ValidateProduct: { simDelay: 1000 },
      SubmitCustomer: { simDelay: 1000, ackDelay: 500 },
      SubmitOrder: { simDelay: 1000, ackDelay: 500 },
    },
  };
}

/**
 * Eval 04: Acknowledgement Delays
 * Tests WAITING_FOR_ACK status with variable ack delays.
 * SubmitCustomer: 2s ack delay, SubmitOrder: 3s ack delay.
 */
export function ackDelaysPayload(): Record<string, unknown> {
  return {
    variant: 'quick-order',
    payload: { entityId: crypto.randomUUID(), customerId: 1, orderId: 1 },
    enableDeduplication: false,
    testOptions: {
      ValidateCustomer: { simDelay: 2000 },
      ValidateProduct: { simDelay: 2000 },
      SubmitCustomer: { simDelay: 3000, ackDelay: 2000 },
      SubmitOrder: { simDelay: 3000, ackDelay: 3000 },
    },
  };
}
