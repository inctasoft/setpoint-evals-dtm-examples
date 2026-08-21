# Worker Callback Contract

Workers communicate with the orchestrator via HTTP callbacks. Every worker **must** call back (success or failure) — the orchestrator cannot proceed without it.

## Endpoint

```
POST /api/v1/callback/step-progress
```

**Host access**: `http://localhost:3002/api/v1/callback/step-progress`
**Container access**: `http://orchestrator:3000/api/v1/callback/step-progress`

The callback URL is provided to workers in the SQS message payload as `callbackUrl`.

## Request Format (`StepProgressDto`)

```typescript
{
  jobId: string;                    // UUID — which job
  stepId: string;                   // UUID — which step
  status: 'in_progress' | 'completed' | 'failed';
  output?: Record<string, unknown>; // Step result data (completed steps)
  error?: string;                   // Error message (failed steps)
  recordsProcessed?: number;        // Successfully processed count
  recordsFailed?: number;           // Failed record count
  dataReference?: {                 // Optional data location reference
    type: 'database_table' | 'database_batch' | 'sqs_queue';
    table?: string;
    batchId?: string;
    metadata?: Record<string, unknown>;
  };
  retryMetadata?: {
    taskHandle?: string;            // Bus-neutral task handle (primary name)
    attemptNumber?: number;         // Bus-neutral delivery attempt (primary name, 1 = first)
    sqsMessageId?: string;          // Compat alias of taskHandle (SQS message ID)
    sqsReceiveCount?: number;       // Compat alias of attemptNumber
    processingTimeMs: number;       // Worker processing time in ms
    isRetry: boolean;               // True if attemptNumber > 1
  };
}
```

### Bus-neutral retry metadata (compat aliases)

`taskHandle` / `attemptNumber` are the bus-neutral primary names; `sqsMessageId` /
`sqsReceiveCount` are accepted compat aliases so one release of mixed worker and
orchestrator versions interoperates. Current workers send BOTH. The orchestrator
prefers the bus-neutral names and falls back to the aliases, so an old worker that
only sends `sqsMessageId` / `sqsReceiveCount` keeps working unchanged.

### Bus-neutral event topics (compat aliases, Phase 3)

Cascade configs name their publish topic with `eventTopic` (bus-neutral primary);
`kafkaTopic` is the accepted compat alias (accept both, prefer `eventTopic`). The
publish + acknowledgement roundtrip itself travels the `EventBus` abstraction
(`EVENT_BUS=kafka|zmq`): under `kafka` it is byte-identical to the original Kafka
flow; under `zmq` the same envelopes travel ZeroMQ PUB/SUB + PUSH/PULL and the
`event-republish-scan` maintenance task recovers dropped publishes. The step
callback contract documented here is identical on both buses.

## Response Format (`StepProgressResponseDto`)

```json
{
  "success": true,
  "message": "Step progress updated",
  "jobId": "uuid",
  "stepId": "uuid"
}
```

## Callback Sequence

Workers typically send two callbacks per step:

### 1. Start Callback (optional but recommended)
```json
{
  "jobId": "...",
  "stepId": "...",
  "status": "in_progress",
  "retryMetadata": { "taskHandle": "...", "attemptNumber": 1, "sqsMessageId": "...", "sqsReceiveCount": 1, "processingTimeMs": 0, "isRetry": false }
}
```

### 2. Completion Callback
```json
{
  "jobId": "...",
  "stepId": "...",
  "status": "completed",
  "recordsProcessed": 1,
  "output": {
    "customerId": 1,
    "firstName": "John",
    "lastName": "Doe"
  },
  "retryMetadata": { "sqsMessageId": "...", "sqsReceiveCount": 1, "processingTimeMs": 245, "isRetry": false }
}
```

### 3. Failure Callback (instead of completion)
```json
{
  "jobId": "...",
  "stepId": "...",
  "status": "failed",
  "error": "Customer 99999 not found in source database",
  "recordsProcessed": 0,
  "retryMetadata": { "sqsMessageId": "...", "sqsReceiveCount": 1, "processingTimeMs": 50, "isRetry": false }
}
```

## Discovery Step Callbacks (Fan-Out)

Discovery steps return an array of item IDs in their output:

```json
{
  "jobId": "...",
  "stepId": "...",
  "status": "completed",
  "recordsProcessed": 3,
  "output": {
    "discoveredIds": [1, 2, 3],
    "cascadeName": "lineItem"
  }
}
```

The orchestrator's `FanOutService` then creates N child steps (one per discovered ID).

## Guard Conditions (Race Prevention)

The callback service enforces these guards:

| Guard | Condition | Action |
|-------|-----------|--------|
| RC1: Terminal state | Step is already COMPLETED, FAILED, SKIPPED, or PARTIAL_SUCCESS | Reject callback (200 OK with warning) |
| RC1b: WAITING_FOR_ACK | Step is waiting for Kafka ACK | Reject callback (already past callback phase) |
| RC2: Discovery deferral | Discovery step with children still executing | Defer continueJob() until children finish |
| RC3: ACK deferral | Transform step needing ACK but cascade deps not met | Defer Kafka publish until parent ACKs arrive |

## SQS Message Format (Input to Workers)

Workers receive this payload via SQS:

```typescript
{
  jobId: string;
  stepId: string;
  stepValue: string;             // e.g., 'ValidateCustomer'
  stepType: string;              // Same as stepValue for workers to key testOptions
  input: Record<string, unknown>; // Step-specific input data
  callbackUrl: string;           // Where to POST callbacks
  correlationId?: string;        // Request trace ID
  testOptions?: Record<string, TestOptionSet>; // Per-step test config
}
```

## TestOptions Fields (Per Step)

```typescript
interface TestOptionSet {
  simDelay?: number;             // Simulated processing delay (ms)
  failureAfter?: number;         // Fail after N records
  failOnAttempts?: number[];     // Fail on specific attempt numbers
  failForItemIds?: string[];     // Fail for specific item IDs
  ackDelay?: number;             // ACK delay (ms) — for dev-ack-simulator
  skipAck?: boolean;             // Don't send ACK — for dev-ack-simulator
  crashBeforeAck?: boolean;      // Crash before ACK — for dev-ack-simulator
  ackPayload?: Record<string, unknown>; // Custom ACK payload — for dev-ack-simulator
  maxRetries?: number;           // Override default retry count
}
```

## Worker SDK Helper

The `@dtm/worker-sdk` package provides utilities:

```typescript
import { getMyTestOptions, sendCallback } from '@dtm/worker-sdk';

// In handler:
const testOptions = getMyTestOptions(message); // Gets step-type-keyed options
await sendCallback(callbackUrl, { jobId, stepId, status: 'completed', output: data });
```

See `packages/worker-sdk/README.md` for complete API reference.
